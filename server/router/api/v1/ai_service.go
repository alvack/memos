package v1

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/lithammer/shortuuid/v4"
	"github.com/openai/openai-go/v2"
	"github.com/openai/openai-go/v2/option"
	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/runner/memopayload"
	"github.com/usememos/memos/store"
)

// AIConfig represents the AI configuration from workspace settings.
type AIConfig struct {
	Endpoint     string
	APIKey       string
	Model        string
	SystemPrompt string
}

// RateLimitData represents the rate limit tracking data.
type RateLimitData struct {
	// Key format: "user_{userID}_{hourTimestamp}"
	// Value: request count
	Counts map[string]int `json:"counts"`
}

const (
	// Rate limit: 5 requests per user per hour
	maxRequestsPerHour = 5
	// Maximum source memos per request
	maxSourceMemos = 50
	// Maximum total characters per request
	maxTotalChars = 10000
	// AI request timeout
	aiRequestTimeout = 30 * time.Second
	// Retry wait time for 429 errors
	retryWaitTime = 60 * time.Second
	// Maximum retry attempts
	maxRetries = 2
	// AI tag identifier
	aiTag = "#AI"
)

// getAIConfig retrieves AI configuration from workspace settings.
func (s *APIV1Service) getAIConfig(ctx context.Context) (*AIConfig, error) {
	workspaceSetting, err := s.Store.GetWorkspaceSetting(ctx, &store.FindWorkspaceSetting{
		Name: storepb.WorkspaceSettingKey_AI_CONFIG.String(),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get AI config from workspace setting")
	}
	if workspaceSetting == nil {
		return nil, status.Errorf(codes.FailedPrecondition, "AI configuration not found. Please configure AI settings in workspace settings.")
	}

	aiSetting := workspaceSetting.GetAiSetting()
	if aiSetting == nil {
		return nil, status.Errorf(codes.FailedPrecondition, "AI configuration is empty")
	}

	// Validate required fields
	if aiSetting.Endpoint == "" {
		return nil, status.Errorf(codes.FailedPrecondition, "AI endpoint is not configured")
	}
	if aiSetting.ApiKey == "" {
		return nil, status.Errorf(codes.FailedPrecondition, "AI API key is not configured")
	}
	if aiSetting.Model == "" {
		return nil, status.Errorf(codes.FailedPrecondition, "AI model is not configured")
	}

	config := &AIConfig{
		Endpoint:     aiSetting.Endpoint,
		APIKey:       aiSetting.ApiKey,
		Model:        aiSetting.Model,
		SystemPrompt: aiSetting.SystemPrompt,
	}

	return config, nil
}

// createOpenAIClient creates a new OpenAI client with the given configuration.
func createOpenAIClient(config *AIConfig) *openai.Client {
	opts := []option.RequestOption{
		option.WithAPIKey(config.APIKey),
	}
	
	// If endpoint is not the default OpenAI endpoint, set base URL
	if config.Endpoint != "" && config.Endpoint != "https://api.openai.com/v1" {
		opts = append(opts, option.WithBaseURL(config.Endpoint))
	}

	client := openai.NewClient(opts...)
	return &client
}

// buildPrompt constructs the AI request prompt from source memos.
func (s *APIV1Service) buildPrompt(ctx context.Context, memos []*store.Memo, systemPrompt string) (string, error) {
	if len(memos) == 0 {
		return "", status.Errorf(codes.InvalidArgument, "no memos provided for summarization")
	}

	// Build memo content list
	var contentBuilder strings.Builder
	totalChars := 0

	for i, memo := range memos {
		content := strings.TrimSpace(memo.Content)
		if content == "" {
			continue
		}

		// Check total character limit
		totalChars += len(content)
		if totalChars > maxTotalChars {
			slog.Warn("Total memo content exceeds character limit", 
				"limit", maxTotalChars, 
				"actual", totalChars,
				"memos_processed", i)
			break
		}

		// Format: [Memo N] content
		contentBuilder.WriteString(fmt.Sprintf("[Memo %d]\n%s\n\n", i+1, content))
	}

	memoContent := contentBuilder.String()
	if memoContent == "" {
		return "", status.Errorf(codes.InvalidArgument, "all memos are empty")
	}

	// Use custom system prompt if provided, otherwise use default
	if systemPrompt == "" {
		systemPrompt = getDefaultSystemPrompt()
	}

	// Build final prompt
	prompt := fmt.Sprintf("%s\n\n%s", systemPrompt, memoContent)
	
	return prompt, nil
}

// getDefaultSystemPrompt returns the default system prompt for AI summarization.
func getDefaultSystemPrompt() string {
	return `You are an AI assistant that helps users summarize their memos. 
Your task is to analyze the provided memos and create a concise, well-structured summary.

Guidelines:
1. Identify the main themes and topics across all memos
2. Highlight key insights, decisions, or action items
3. Organize the summary in a clear, readable format using Markdown
4. Keep the summary concise but comprehensive (aim for 200-500 words)
5. Use bullet points or numbered lists where appropriate
6. If there are related memos, group them by topic
7. Maintain a neutral, professional tone

Please provide a summary of the following memos:`
}

// checkRateLimit checks if the user has exceeded the rate limit.
func (s *APIV1Service) checkRateLimit(ctx context.Context, userID int32) error {
	// Get current hour timestamp
	now := time.Now()
	hourTimestamp := now.Truncate(time.Hour).Unix()
	rateLimitKey := fmt.Sprintf("user_%d_%d", userID, hourTimestamp)

	// Get rate limit data from workspace setting
	workspaceSetting, err := s.Store.GetWorkspaceSetting(ctx, &store.FindWorkspaceSetting{
		Name: storepb.WorkspaceSettingKey_AI_RATE_LIMIT.String(),
	})
	if err != nil {
		return errors.Wrap(err, "failed to get rate limit data")
	}

	var rateLimitData RateLimitData
	if workspaceSetting != nil && workspaceSetting.GetAiRateLimit() != "" {
		if err := json.Unmarshal([]byte(workspaceSetting.GetAiRateLimit()), &rateLimitData); err != nil {
			slog.Warn("failed to unmarshal rate limit data, resetting", "error", err)
			rateLimitData = RateLimitData{Counts: make(map[string]int)}
		}
	} else {
		rateLimitData = RateLimitData{Counts: make(map[string]int)}
	}

	// Check current count
	currentCount := rateLimitData.Counts[rateLimitKey]
	if currentCount >= maxRequestsPerHour {
		return status.Errorf(codes.ResourceExhausted, 
			"rate limit exceeded: maximum %d requests per hour allowed", maxRequestsPerHour)
	}

	return nil
}

// updateRateLimit increments the rate limit counter for the user.
func (s *APIV1Service) updateRateLimit(ctx context.Context, userID int32) error {
	// Get current hour timestamp
	now := time.Now()
	hourTimestamp := now.Truncate(time.Hour).Unix()
	rateLimitKey := fmt.Sprintf("user_%d_%d", userID, hourTimestamp)

	// Get rate limit data from workspace setting
	workspaceSetting, err := s.Store.GetWorkspaceSetting(ctx, &store.FindWorkspaceSetting{
		Name: storepb.WorkspaceSettingKey_AI_RATE_LIMIT.String(),
	})
	if err != nil {
		return errors.Wrap(err, "failed to get rate limit data")
	}

	var rateLimitData RateLimitData
	if workspaceSetting != nil && workspaceSetting.GetAiRateLimit() != "" {
		if err := json.Unmarshal([]byte(workspaceSetting.GetAiRateLimit()), &rateLimitData); err != nil {
			slog.Warn("failed to unmarshal rate limit data, resetting", "error", err)
			rateLimitData = RateLimitData{Counts: make(map[string]int)}
		}
	} else {
		rateLimitData = RateLimitData{Counts: make(map[string]int)}
	}

	// Clean up expired data (older than 24 hours)
	cutoffTimestamp := now.Add(-24 * time.Hour).Truncate(time.Hour).Unix()
	for key := range rateLimitData.Counts {
		var keyUserID int32
		var keyTimestamp int64
		if _, err := fmt.Sscanf(key, "user_%d_%d", &keyUserID, &keyTimestamp); err == nil {
			if keyTimestamp < cutoffTimestamp {
				delete(rateLimitData.Counts, key)
			}
		}
	}

	// Increment counter
	rateLimitData.Counts[rateLimitKey]++

	// Save back to workspace setting
	rateLimitJSON, err := json.Marshal(rateLimitData)
	if err != nil {
		return errors.Wrap(err, "failed to marshal rate limit data")
	}

	_, err = s.Store.UpsertWorkspaceSetting(ctx, &storepb.WorkspaceSetting{
		Key:   storepb.WorkspaceSettingKey_AI_RATE_LIMIT,
		Value: &storepb.WorkspaceSetting_AiRateLimit{AiRateLimit: string(rateLimitJSON)},
	})
	if err != nil {
		return errors.Wrap(err, "failed to update rate limit data")
	}

	return nil
}

// querySourceMemos retrieves source memos for AI summarization.
func (s *APIV1Service) querySourceMemos(ctx context.Context, userID int32, request *v1pb.GenerateAISummaryRequest) ([]*store.Memo, error) {
	// Parse time range
	var startTime, endTime int64
	now := time.Now()

	switch request.TimeRange {
	case "7d":
		startTime = now.AddDate(0, 0, -7).Unix()
		endTime = now.Unix()
	case "30d":
		startTime = now.AddDate(0, 0, -30).Unix()
		endTime = now.Unix()
	case "90d":
		startTime = now.AddDate(0, 0, -90).Unix()
		endTime = now.Unix()
	case "custom":
		if request.StartDate == "" || request.EndDate == "" {
			return nil, status.Errorf(codes.InvalidArgument, "start_date and end_date are required for custom time range")
		}
		
		startDate, err := time.Parse("2006-01-02", request.StartDate)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid start_date format, expected YYYY-MM-DD")
		}
		endDate, err := time.Parse("2006-01-02", request.EndDate)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid end_date format, expected YYYY-MM-DD")
		}
		
		if endDate.Before(startDate) {
			return nil, status.Errorf(codes.InvalidArgument, "end_date must be after start_date")
		}
		
		startTime = startDate.Unix()
		endTime = endDate.Add(24 * time.Hour).Unix() // Include the entire end date
	default:
		return nil, status.Errorf(codes.InvalidArgument, "invalid time_range: must be one of 7d, 30d, 90d, or custom")
	}

	// Build filters
	filters := []string{
		fmt.Sprintf("created_ts >= %d", startTime),
		fmt.Sprintf("created_ts < %d", endTime),
		fmt.Sprintf("content_search != ['%s']", aiTag), // Exclude AI memos
	}

	// Add tag filters if specified
	if len(request.Tags) > 0 {
		tagFilters := make([]string, len(request.Tags))
		for i, tag := range request.Tags {
			// Ensure tag starts with #
			if !strings.HasPrefix(tag, "#") {
				tag = "#" + tag
			}
			tagFilters[i] = fmt.Sprintf("'%s'", tag)
		}
		filters = append(filters, fmt.Sprintf("content_search == [%s]", strings.Join(tagFilters, " || ")))
	}

	// Query memos
	limit := maxSourceMemos
	normalStatus := store.Normal
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		CreatorID:        &userID,
		RowStatus:        &normalStatus,
		Filters:          filters,
		Limit:            &limit,
		OrderByUpdatedTs: false,
		OrderByTimeAsc:   false, // Most recent first
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to query source memos")
	}

	if len(memos) == 0 {
		return nil, status.Errorf(codes.NotFound, "no memos found in the specified time range")
	}

	return memos, nil
}

// callAIWithRetry calls the AI API with retry logic for 429 errors.
func (s *APIV1Service) callAIWithRetry(ctx context.Context, config *AIConfig, prompt string) (string, error) {
	client := createOpenAIClient(config)
	
	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			slog.Info("retrying AI API call", "attempt", attempt, "max_retries", maxRetries)
			time.Sleep(retryWaitTime)
		}

		// Create context with timeout
		timeoutCtx, cancel := context.WithTimeout(ctx, aiRequestTimeout)
		defer cancel()

		// Build messages
		messages := []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(config.SystemPrompt),
			openai.UserMessage(prompt),
		}

		// Call OpenAI API
		chatCompletion, err := client.Chat.Completions.New(timeoutCtx, openai.ChatCompletionNewParams{
			Messages: messages,
			Model:    openai.ChatModel(config.Model),
		})

		if err != nil {
			lastErr = err
			
			// Check if it's a rate limit error (429)
			if strings.Contains(err.Error(), "429") || strings.Contains(err.Error(), "rate_limit") {
				slog.Warn("AI API rate limit exceeded, will retry", 
					"attempt", attempt, 
					"wait_time", retryWaitTime)
				continue
			}
			
			// For other errors, don't retry
			return "", errors.Wrap(err, "AI API call failed")
		}

		// Extract content from response
		if len(chatCompletion.Choices) == 0 {
			return "", status.Errorf(codes.Internal, "AI API returned no choices")
		}

		content := chatCompletion.Choices[0].Message.Content
		if content == "" {
			return "", status.Errorf(codes.Internal, "AI API returned empty content")
		}

		// Validate content length (100-5000 characters)
		if len(content) < 100 {
			return "", status.Errorf(codes.InvalidArgument, 
				"AI generated summary is too short (minimum 100 characters)")
		}
		if len(content) > 5000 {
			slog.Warn("AI generated summary exceeds maximum length, truncating", 
				"length", len(content), 
				"max", 5000)
			content = content[:5000]
		}

		return content, nil
	}

	// All retries exhausted
	return "", errors.Wrapf(lastErr, "AI API call failed after %d retries", maxRetries)
}

// createAIMemo creates a new AI memo with the generated summary.
func (s *APIV1Service) createAIMemo(ctx context.Context, userID int32, summary string, timeRange string, startDate string, endDate string) (*store.Memo, error) {
	// Build memo content with metadata
	var contentBuilder strings.Builder
	
	// Add generation metadata
	contentBuilder.WriteString(fmt.Sprintf("<!-- AI Generated Summary -->\n"))
	contentBuilder.WriteString(fmt.Sprintf("**Generated:** %s\n", time.Now().Format("2006-01-02 15:04:05")))
	
	// Add time range info
	if timeRange == "custom" && startDate != "" && endDate != "" {
		contentBuilder.WriteString(fmt.Sprintf("**Time Range:** %s to %s\n\n", startDate, endDate))
	} else {
		contentBuilder.WriteString(fmt.Sprintf("**Time Range:** Last %s\n\n", timeRange))
	}
	
	contentBuilder.WriteString("---\n\n")
	contentBuilder.WriteString(summary)
	
	// Ensure content includes #AI tag
	content := contentBuilder.String()
	if !strings.Contains(content, aiTag) {
		content = content + "\n\n" + aiTag
	}

	// Create memo
	create := &store.Memo{
		UID:        shortuuid.New(),
		CreatorID:  userID,
		Content:    content,
		Visibility: store.Private, // AI memos are private by default
		Pinned:     false,
	}

	// Rebuild payload to extract tags and properties
	if err := memopayload.RebuildMemoPayload(create); err != nil {
		return nil, errors.Wrap(err, "failed to rebuild memo payload")
	}

	// Create the memo
	memo, err := s.Store.CreateMemo(ctx, create)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create AI memo")
	}

	return memo, nil
}

// createMemoRelations creates memo relations between AI memo and source memos.
func (s *APIV1Service) createMemoRelations(ctx context.Context, aiMemoID int32, sourceMemos []*store.Memo) error {
	for _, sourceMemo := range sourceMemos {
		relation := &store.MemoRelation{
			MemoID:        aiMemoID,
			RelatedMemoID: sourceMemo.ID,
			Type:          store.MemoRelationReference,
		}
		
		if _, err := s.Store.UpsertMemoRelation(ctx, relation); err != nil {
			slog.Error("failed to create memo relation", 
				"ai_memo_id", aiMemoID, 
				"source_memo_id", sourceMemo.ID, 
				"error", err)
			// Continue with other relations even if one fails
		}
	}
	
	return nil
}

// TestAIConfig tests the AI configuration by sending a simple test request.
func (s *APIV1Service) TestAIConfig(ctx context.Context, request *v1pb.TestAIConfigRequest) (*v1pb.TestAIConfigResponse, error) {
	// Get current user (must be authenticated)
	user, err := s.GetCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	// Get AI configuration
	config, err := s.getAIConfig(ctx)
	if err != nil {
		return &v1pb.TestAIConfigResponse{
			Success:      false,
			ErrorMessage: fmt.Sprintf("Failed to get AI configuration: %v", err),
			Details:      "Please ensure AI configuration is properly set in workspace settings.",
		}, nil
	}

	// Log test configuration (without sensitive data)
	slog.Info("Testing AI configuration",
		"user_id", user.ID,
		"endpoint", config.Endpoint,
		"model", config.Model)

	// Create OpenAI client
	client := createOpenAIClient(config)

	// Create a simple test message
	testPrompt := "Hello! This is a test message. Please respond with 'Test successful' if you receive this."

	// Create context with timeout (30 seconds for test to accommodate slower providers)
	testCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// Build messages
	messages := []openai.ChatCompletionMessageParamUnion{
		openai.UserMessage(testPrompt),
	}

	// Send test request to AI provider
	slog.Info("Sending test request to AI provider", "endpoint", config.Endpoint)
	chatCompletion, err := client.Chat.Completions.New(testCtx, openai.ChatCompletionNewParams{
		Messages: messages,
		Model:    openai.ChatModel(config.Model),
	})

	if err != nil {
		// Parse error details
		errorMsg := err.Error()
		details := "Failed to connect to AI provider. Please check your configuration."

		// Provide more specific error messages
		if strings.Contains(errorMsg, "timeout") || strings.Contains(errorMsg, "deadline exceeded") {
			details = "Request timed out. Please check your network connection and endpoint URL."
		} else if strings.Contains(errorMsg, "401") || strings.Contains(errorMsg, "unauthorized") {
			details = "Authentication failed. Please check your API key."
		} else if strings.Contains(errorMsg, "404") || strings.Contains(errorMsg, "not found") {
			details = "Endpoint not found. Please check your endpoint URL."
		} else if strings.Contains(errorMsg, "429") || strings.Contains(errorMsg, "rate_limit") {
			details = "Rate limit exceeded. Please try again later."
		} else if strings.Contains(errorMsg, "model") {
			details = "Invalid model name. Please check your model configuration."
		}

		slog.Error("AI config test failed", 
			"user_id", user.ID, 
			"endpoint", config.Endpoint,
			"model", config.Model,
			"error", err)

		return &v1pb.TestAIConfigResponse{
			Success:      false,
			ErrorMessage: errorMsg,
			Details:      details,
		}, nil
	}

	// Validate response
	if len(chatCompletion.Choices) == 0 {
		return &v1pb.TestAIConfigResponse{
			Success:      false,
			ErrorMessage: "AI provider returned no response",
			Details:      "The AI provider responded but did not return any content. This may indicate a configuration issue.",
		}, nil
	}

	responseContent := chatCompletion.Choices[0].Message.Content
	if responseContent == "" {
		return &v1pb.TestAIConfigResponse{
			Success:      false,
			ErrorMessage: "AI provider returned empty content",
			Details:      "The AI provider responded but the content was empty. This may indicate a configuration issue.",
		}, nil
	}

	// Test successful
	slog.Info("AI config test successful", 
		"user_id", user.ID, 
		"endpoint", config.Endpoint,
		"model", config.Model,
		"response_length", len(responseContent))

	return &v1pb.TestAIConfigResponse{
		Success: true,
		Details: fmt.Sprintf("Successfully connected to AI provider. Model: %s, Response length: %d characters", 
			config.Model, len(responseContent)),
	}, nil
}

// GetMemoSourceMemos retrieves the source memos that were used to generate an AI summary.
func (s *APIV1Service) GetMemoSourceMemos(ctx context.Context, request *v1pb.GetMemoSourceMemosRequest) (*v1pb.GetMemoSourceMemosResponse, error) {
	// Parse memo name to get memo UID
	memoUID, err := ExtractMemoUIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}

	// Get the AI memo to verify it exists and user has access
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{
		UID: &memoUID,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get memo")
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}

	// Check user permission
	currentUser, err := s.GetCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if currentUser == nil {
		// For unauthenticated users, only allow public memos
		if memo.Visibility != store.Public {
			return nil, status.Errorf(codes.PermissionDenied, "permission denied")
		}
	} else if memo.CreatorID != currentUser.ID {
		// For authenticated users, check visibility
		if memo.Visibility == store.Private {
			return nil, status.Errorf(codes.PermissionDenied, "permission denied")
		}
	}

	// Query memo relations to get source memo IDs
	referenceType := store.MemoRelationReference
	relations, err := s.Store.ListMemoRelations(ctx, &store.FindMemoRelation{
		MemoID: &memo.ID,
		Type:   &referenceType,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list memo relations")
	}

	if len(relations) == 0 {
		// No source memos found, return empty response
		return &v1pb.GetMemoSourceMemosResponse{
			Memos:     []*v1pb.Memo{},
			TotalSize: 0,
		}, nil
	}

	// Extract source memo IDs
	sourceMemoIDs := make([]int32, 0, len(relations))
	for _, relation := range relations {
		sourceMemoIDs = append(sourceMemoIDs, relation.RelatedMemoID)
	}

	// Batch query source memos
	normalStatus := store.Normal
	sourceMemos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		IDList:    sourceMemoIDs,
		RowStatus: &normalStatus,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to query source memos")
	}

	// Get reactions and attachments for all source memos
	reactionMap := make(map[int32][]*store.Reaction)
	attachmentMap := make(map[int32][]*store.Attachment)

	if len(sourceMemos) > 0 {
		// Query reactions for each source memo
		for _, m := range sourceMemos {
			memoName := fmt.Sprintf("%s%s", MemoNamePrefix, m.UID)
			reactions, err := s.Store.ListReactions(ctx, &store.FindReaction{
				ContentID: &memoName,
			})
			if err != nil {
				slog.Warn("failed to list reactions", "memo_id", m.ID, "error", err)
			} else {
				reactionMap[m.ID] = reactions
			}
		}

		// Query attachments for each source memo
		for _, m := range sourceMemos {
			attachments, err := s.Store.ListAttachments(ctx, &store.FindAttachment{
				MemoID: &m.ID,
			})
			if err != nil {
				slog.Warn("failed to list attachments", "memo_id", m.ID, "error", err)
				continue
			}
			attachmentMap[m.ID] = attachments
		}
	}

	// Convert to protobuf messages
	memoMessages := make([]*v1pb.Memo, 0, len(sourceMemos))
	for _, sourceMemo := range sourceMemos {
		reactions := reactionMap[sourceMemo.ID]
		attachments := attachmentMap[sourceMemo.ID]

		memoMessage, err := s.convertMemoFromStore(ctx, sourceMemo, reactions, attachments)
		if err != nil {
			slog.Warn("failed to convert memo", "memo_id", sourceMemo.ID, "error", err)
			continue
		}
		memoMessages = append(memoMessages, memoMessage)
	}

	return &v1pb.GetMemoSourceMemosResponse{
		Memos:     memoMessages,
		TotalSize: int32(len(memoMessages)),
	}, nil
}

// GenerateAISummary generates an AI summary of user's memos.
func (s *APIV1Service) GenerateAISummary(ctx context.Context, request *v1pb.GenerateAISummaryRequest) (*v1pb.Memo, error) {
	// Get current user
	user, err := s.GetCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	// Check rate limit
	if err := s.checkRateLimit(ctx, user.ID); err != nil {
		return nil, err
	}

	// Get AI configuration
	config, err := s.getAIConfig(ctx)
	if err != nil {
		return nil, err
	}

	// Query source memos
	sourceMemos, err := s.querySourceMemos(ctx, user.ID, request)
	if err != nil {
		return nil, err
	}

	slog.Info("queried source memos for AI summary", 
		"user_id", user.ID, 
		"count", len(sourceMemos),
		"time_range", request.TimeRange)

	// Build prompt
	prompt, err := s.buildPrompt(ctx, sourceMemos, config.SystemPrompt)
	if err != nil {
		return nil, err
	}

	// Call AI API with retry logic
	summary, err := s.callAIWithRetry(ctx, config, prompt)
	if err != nil {
		slog.Error("failed to generate AI summary", 
			"user_id", user.ID, 
			"error", err)
		return nil, status.Errorf(codes.Internal, "failed to generate AI summary: %v", err)
	}

	slog.Info("AI summary generated successfully", 
		"user_id", user.ID, 
		"summary_length", len(summary))

	// Create AI memo
	aiMemo, err := s.createAIMemo(ctx, user.ID, summary, request.TimeRange, request.StartDate, request.EndDate)
	if err != nil {
		return nil, err
	}

	// Create memo relations
	if err := s.createMemoRelations(ctx, aiMemo.ID, sourceMemos); err != nil {
		slog.Warn("failed to create some memo relations", "error", err)
		// Don't fail the entire operation if relations fail
	}

	// Update rate limit counter
	if err := s.updateRateLimit(ctx, user.ID); err != nil {
		slog.Warn("failed to update rate limit counter", "error", err)
		// Don't fail the operation if rate limit update fails
	}

	// Convert to protobuf and return
	memoMessage, err := s.convertMemoFromStore(ctx, aiMemo, nil, nil)
	if err != nil {
		return nil, errors.Wrap(err, "failed to convert memo")
	}

	return memoMessage, nil
}
