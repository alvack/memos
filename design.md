# AI Memo 总结功能技术设计方案

## Linus 式设计哲学

**"数据结构优先，消除特殊情况，但必须满足真实需求"**

## 需求分析（基于 requirement.md）

**必需功能**：
1. AI 配置管理 - 管理员配置 API 参数
2. 手动总结生成 - 用户选择范围生成总结
3. 定时自动总结 - 按用户设置的频率自动生成
4. API 限流保护 - 防止滥用和超支
5. 国际化支持 - 多语言界面
6. 错误降级处理 - AI 失败不影响主功能

## 技术方案

### 1. 数据结构扩展（最小化）

**扩展现有表，零新增表**
```sql
-- workspace_setting 表添加 AI 配置
INSERT INTO workspace_setting (name, value) VALUES
('ai.config', '{"endpoint":"https://api.openai.com/v1","api_key":"sk-...","model":"gpt-4o-mini","system_prompt":"..."}');

-- user_setting 表添加自动总结频率
INSERT INTO user_setting (user_id, key, value) VALUES
(1, 'ai.auto_summary.frequency_days', '7');

-- workspace_setting 表添加限流计数
INSERT INTO workspace_setting (name, value) VALUES
('ai.rate_limit.user_id_timestamp_count', '{"user_123":1698784000:3}');

-- 使用现有 memo_relation 表存储 AI Memo 与 Source Memos 的关联关系
-- AI Memo 作为 memo_id，Source Memo 作为 related_memo_id，type 为 'REFERENCE'
INSERT INTO memo_relation (memo_id, related_memo_id, type) VALUES
(ai_memo_id, source_memo_id_1, 'REFERENCE'),
(ai_memo_id, source_memo_id_2, 'REFERENCE');

-- user_setting 表添加定时任务失败计数（用于自动禁用功能）
INSERT INTO user_setting (user_id, key, value) VALUES
(1, 'ai.auto_summary.failure_count', '0');
```

**Protocol Buffers 扩展**
```protobuf
// 在现有 WorkspaceSettingKey 枚举添加
enum WorkspaceSettingKey {
  // ... 现有 keys
  AI_CONFIG = 15;
  AI_RATE_LIMIT = 16;
}

// 在现有 UserSettingKey 枚举添加
enum UserSettingKey {
  // ... 现有 keys
  AI_AUTO_SUMMARY_FREQUENCY_DAYS = 12;
  AI_AUTO_SUMMARY_FAILURE_COUNT = 13;
}
```

### 2. 后端实现

**核心 AI 服务（单一职责）**
```go
// 新文件：server/ai/ai_service.go
package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/pkg/errors"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/store"
	storepb "github.com/usememos/memos/proto/gen/store"
)

type AIService struct {
	store  *store.Store
	client *openai.Client
}

type AIConfig struct {
	Endpoint     string `json:"endpoint"`
	APIKey       string `json:"api_key"`
	Model        string `json:"model"`
	SystemPrompt string `json:"system_prompt"`
}

type SummaryRequest struct {
	UserID       int32
	TimeRange    string
	Tags         []string
	Language     string
	SystemPrompt string
	Model        string
	StartDate    *time.Time
	EndDate      *time.Time
}

type SummaryResponse struct {
	Content        string
	TokenUsed      int
	Duration       time.Duration
	SourceMemoIDs  []int32  // 用于生成总结的 Source Memos ID 列表
}

func NewAIService(store *store.Store) (*AIService, error) {
	config, err := getAIConfig(store)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get AI config")
	}

	if config.APIKey == "" {
		return nil, errors.New("AI API key not configured")
	}

	client := openai.NewClient(
		option.WithAPIKey(config.APIKey),
		option.WithBaseURL(config.Endpoint),
	)

	return &AIService{
		store:  store,
		client: client,
	}, nil
}

func getAIConfig(store *store.Store) (*AIConfig, error) {
	workspaceSetting, err := store.GetWorkspaceSetting(context.Background(), &store.FindWorkspaceSetting{
		Name: storepb.WorkspaceSettingKey_AI_CONFIG.String(),
	})
	if err != nil {
		return nil, err
	}

	config := &AIConfig{
		Endpoint:     "https://api.openai.com/v1",
		APIKey:       "",
		Model:        "gpt-4o-mini",
		SystemPrompt: "请总结以下备忘录内容，提取关键主题、重要事件和待办事项。使用简洁的 Markdown 格式输出。",
	}

	if workspaceSetting != nil {
		if err := json.Unmarshal([]byte(workspaceSetting.GetAIConfig()), config); err != nil {
			return nil, errors.Wrap(err, "failed to unmarshal AI config")
		}
	}

	return config, nil
}

func (s *AIService) GenerateSummary(ctx context.Context, req *SummaryRequest) (*SummaryResponse, error) {
	startTime := time.Now()

	// 1. 查询符合条件的 source memos
	sourceMemos, err := s.getSourceMemos(ctx, req)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get source memos")
	}

	if len(sourceMemos) == 0 {
		return nil, errors.New("no memos found for summary generation")
	}

	// 2. 构建 prompt
	prompt := s.buildPrompt(sourceMemos, req)

	// 3. 调用 OpenAI API（30秒超时）
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	resp, err := s.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(req.SystemPrompt),
			openai.UserMessage(prompt),
		},
		Model: openai.F(req.Model),
		MaxTokens: openai.F(2000),
		Temperature: openai.F(0.3),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to call OpenAI API")
	}

	if len(resp.Choices) == 0 {
		return nil, errors.New("no response from OpenAI API")
	}

	content := resp.Choices[0].Message.Content
	if strings.TrimSpace(content) == "" {
		return nil, errors.New("empty response from OpenAI API")
	}

	// 提取 Source Memo IDs
	sourceMemoIDs := make([]int32, len(sourceMemos))
	for i, memo := range sourceMemos {
		sourceMemoIDs[i] = memo.ID
	}

	return &SummaryResponse{
		Content:       content,
		TokenUsed:     resp.Usage.TotalTokens,
		Duration:      time.Since(startTime),
		SourceMemoIDs: sourceMemoIDs,
	}, nil
}

func (s *AIService) getSourceMemos(ctx context.Context, req *SummaryRequest) ([]*store.Memo, error) {
	// 构建时间范围
	now := time.Now()
	var startTime time.Time

	switch req.TimeRange {
	case "7d":
		startTime = now.AddDate(0, 0, -7)
	case "30d":
		startTime = now.AddDate(0, 0, -30)
	case "90d":
		startTime = now.AddDate(0, 0, -90)
	case "custom":
		if req.StartDate != nil {
			startTime = *req.StartDate
		} else {
			startTime = now.AddDate(0, 0, -7) // 默认7天
		}
	default:
		startTime = now.AddDate(0, 0, -7) // 默认7天
	}

	endTime := now
	if req.EndDate != nil {
		endTime = *req.EndDate
	}

	// 查询备忘录
	memos, err := s.store.ListMemos(ctx, &store.FindMemo{
		CreatorID: &req.UserID,
		RowStatus: &store.Normal,
		Limit:     &[]int32{50}[0], // 限制最多50条
	})
	if err != nil {
		return nil, err
	}

	// 过滤时间和标签
	var filteredMemos []*store.Memo
	for _, memo := range memos {
		memoTime := time.Unix(memo.CreatedTs, 0)
		if memoTime.Before(startTime) || memoTime.After(endTime) {
			continue
		}

		// 跳过 AI memos
		if strings.Contains(memo.Content, "#AI") || strings.Contains(memo.Content, "#ai") {
			continue
		}

		// 标签过滤（如果指定了标签）
		if len(req.Tags) > 0 {
			memoTags := s.extractTags(memo.Content)
			hasMatch := false
			for _, reqTag := range req.Tags {
				for _, memoTag := range memoTags {
					if strings.EqualFold(memoTag, reqTag) {
						hasMatch = true
						break
					}
				}
				if hasMatch {
					break
				}
			}
			if !hasMatch {
				continue
			}
		}

		filteredMemos = append(filteredMemos, memo)
	}

	// 按时间倒序排列
	for i, j := 0, len(filteredMemos)-1; i < j; i, j = i+1, j-1 {
		filteredMemos[i], filteredMemos[j] = filteredMemos[j], filteredMemos[i]
	}

	return filteredMemos, nil
}

func (s *AIService) buildPrompt(memos []*store.Memo, req *SummaryRequest) string {
	var builder strings.Builder

	// 根据语言添加说明
	switch req.Language {
	case "zh", "zh-CN", "zh-TW":
		builder.WriteString("请总结以下备忘录内容，提取关键主题、重要事件和待办事项。使用简洁的 Markdown 格式输出。\n\n")
	default:
		builder.WriteString("Please summarize the following memo content, extracting key themes, important events, and todo items. Output in concise Markdown format.\n\n")
	}

	// 添加备忘录内容
	totalChars := 0
	for i, memo := range memos {
		if totalChars+len(memo.Content) > 10000 { // 限制总字符数
			break
		}

		memoTime := time.Unix(memo.CreatedTs, 0)
		builder.WriteString(fmt.Sprintf("## Memo %d (%s)\n\n", i+1, memoTime.Format("2006-01-02 15:04")))
		builder.WriteString(memo.Content)
		builder.WriteString("\n\n")

		totalChars += len(memo.Content)
	}

	// 添加输出格式要求
	switch req.Language {
	case "zh", "zh-CN", "zh-TW":
		builder.WriteString("\n请按以下格式输出：\n")
		builder.WriteString("- 使用标题区分不同主题\n")
		builder.WriteString("- 使用列表记录重要事件和待办事项\n")
		builder.WriteString("- 总结内容控制在 100-5000 字符之间\n")
	default:
		builder.WriteString("\nPlease output in the following format:\n")
		builder.WriteString("- Use headings to separate different topics\n")
		builder.WriteString("- Use lists for important events and todo items\n")
		builder.WriteString("- Keep summary content between 100-5000 characters\n")
	}

	return builder.String()
}

func (s *AIService) extractTags(content string) []string {
	// 简单的标签提取逻辑
	var tags []string
	words := strings.Fields(content)
	for _, word := range words {
		if strings.HasPrefix(word, "#") {
			tag := strings.Trim(word, "#[]()。，！？；：")
			if tag != "" {
				tags = append(tags, tag)
			}
		}
	}
	return tags
}

func (s *AIService) GenerateSummaryWithRetry(ctx context.Context, req *SummaryRequest, maxRetries int) (*SummaryResponse, error) {
	var lastErr error

	for i := 0; i <= maxRetries; i++ {
		if i > 0 {
			slog.Info("Retrying AI summary generation", "attempt", i+1, "max_attempts", maxRetries+1)
			time.Sleep(time.Duration(i) * time.Second) // 指数退避
		}

		resp, err := s.GenerateSummary(ctx, req)
		if err == nil {
			return resp, nil
		}

		lastErr = err

		// 如果是限流错误，等待更长时间
		if strings.Contains(err.Error(), "rate limit") || strings.Contains(err.Error(), "429") {
			slog.Info("Rate limit hit, waiting longer", "attempt", i+1)
			time.Sleep(60 * time.Second)
			continue
		}
	}

	return nil, lastErr
}
```

**API 端点（复用现有架构）**
```go
// 扩展现有 memo_service.go
func (s *APIV1Service) GenerateAISummary(ctx context.Context, request *v1pb.GenerateAISummaryRequest) (*v1pb.Memo, error) {
	// 1. 权限检查
	user, err := s.GetCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	// 2. 限流检查（从 workspace_setting 读取计数）
	if !s.checkRateLimit(user.ID) {
		return nil, status.Errorf(codes.ResourceExhausted, "rate limit exceeded: maximum 5 summaries per hour")
	}

	// 3. 获取 AI 配置
	aiConfig, err := getAIConfig(s.Store)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get AI config: %v", err)
	}

	if aiConfig.APIKey == "" {
		return nil, status.Errorf(codes.FailedPrecondition, "AI service not configured")
	}

	// 4. 创建 AI 服务
	aiService, err := NewAIService(s.Store)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create AI service: %v", err)
	}

	// 5. 解析时间范围
	var startDate, endDate *time.Time
	if request.StartDate != "" {
		if parsed, err := time.Parse("2006-01-02", request.StartDate); err == nil {
			startDate = &parsed
		}
	}
	if request.EndDate != "" {
		if parsed, err := time.Parse("2006-01-02", request.EndDate); err == nil {
			endDate = &parsed
		}
	}

	// 6. 构建总结请求
	req := &SummaryRequest{
		UserID:       user.ID,
		TimeRange:    request.TimeRange,
		Tags:         request.Tags,
		Language:     user.GetLocale(), // 从用户设置获取语言
		SystemPrompt: aiConfig.SystemPrompt,
		Model:        aiConfig.Model,
		StartDate:    startDate,
		EndDate:      endDate,
	}

	// 7. 生成总结内容（带重试）
	summary, err := aiService.GenerateSummaryWithRetry(ctx, req, 2)
	if err != nil {
		slog.Error("AI summary generation failed", "user_id", user.ID, "error", err)
		return nil, status.Errorf(codes.Internal, "failed to generate summary: %v", err)
	}

	// 8. 格式化总结内容
	formattedContent := s.formatAISummaryContent(summary, req)

	// 9. 创建标准 Memo（复用现有逻辑）
	createMemoRequest := &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{
			Content:    formattedContent,
			Visibility: v1pb.Visibility_PRIVATE,
			Pinned:     false,
		},
	}

	// 10. 创建 Memo 并添加 #AI 标签
	memo, err := s.CreateMemo(ctx, createMemoRequest)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create AI memo: %v", err)
	}

	// 11. 创建 AI Memo 与 Source Memos 的关联关系
	if err := s.createMemoRelations(ctx, memo.Name, summary.SourceMemoIDs); err != nil {
		slog.Error("Failed to create memo relations", "ai_memo", memo.Name, "error", err)
		// 关联失败不影响 AI Memo 的创建，只记录日志
	}

	// 12. 更新限流计数
	s.updateRateLimit(user.ID)

	slog.Info("AI summary generated successfully", "user_id", user.ID, "memo_id", memo.Name, "tokens_used", summary.TokenUsed, "duration", summary.Duration)

	return memo, nil
}

func (s *APIV1Service) createMemoRelations(ctx context.Context, aiMemoName string, sourceMemoIDs []int32) error {
	// 从 memo name 提取 memo ID
	aiMemoID, err := s.getMemoIDFromName(ctx, aiMemoName)
	if err != nil {
		return err
	}

	// 为每个 Source Memo 创建关联关系
	for _, sourceMemoID := range sourceMemoIDs {
		if err := s.Store.UpsertMemoRelation(ctx, &store.MemoRelation{
			MemoID:        aiMemoID,
			RelatedMemoID: sourceMemoID,
			Type:          store.MemoRelationReference,
		}); err != nil {
			return fmt.Errorf("failed to create relation for memo %d: %w", sourceMemoID, err)
		}
	}

	return nil
}

func (s *APIV1Service) checkRateLimit(userID int32) bool {
	ctx := context.Background()

	// 获取当前时间戳
	now := time.Now()
	currentHour := now.Truncate(time.Hour).Unix()

	// 从 workspace_setting 读取该用户的调用计数
	workspaceSetting, err := s.Store.GetWorkspaceSetting(ctx, &store.FindWorkspaceSetting{
		Name: storepb.WorkspaceSettingKey_AI_RATE_LIMIT.String(),
	})
	if err != nil {
		slog.Error("Failed to get rate limit setting", "error", err)
		return true // 失败时允许通过
	}

	// 解析限流数据
	rateLimitData := make(map[string]string)
	if workspaceSetting != nil && workspaceSetting.GetAIRateLimit() != "" {
		if err := json.Unmarshal([]byte(workspaceSetting.GetAIRateLimit()), (*map[string]string)(&rateLimitData)); err != nil {
			slog.Error("Failed to unmarshal rate limit data", "error", err)
			return true
		}
	}

	// 检查当前小时的调用次数
	key := fmt.Sprintf("user_%d_%d", userID, currentHour)
	countStr := rateLimitData[key]
	count := 0
	if countStr != "" {
		if parsed, err := fmt.Sscanf(countStr, "%d", &count); err != nil || parsed != 1 {
			count = 0
		}
	}

	// 检查是否超过限制
	if count >= 5 {
		return false
	}

	return true
}

func (s *APIV1Service) updateRateLimit(userID int32) {
	ctx := context.Background()

	// 获取当前时间戳
	now := time.Now()
	currentHour := now.Truncate(time.Hour).Unix()

	// 获取现有限流数据
	workspaceSetting, _ := s.Store.GetWorkspaceSetting(ctx, &store.FindWorkspaceSetting{
		Name: storepb.WorkspaceSettingKey_AI_RATE_LIMIT.String(),
	})

	rateLimitData := make(map[string]string)
	if workspaceSetting != nil && workspaceSetting.GetAIRateLimit() != "" {
		json.Unmarshal([]byte(workspaceSetting.GetAIRateLimit()), (*map[string]string)(&rateLimitData))
	}

	// 更新计数
	key := fmt.Sprintf("user_%d_%d", userID, currentHour)
	countStr := rateLimitData[key]
	count := 0
	if countStr != "" {
		fmt.Sscanf(countStr, "%d", &count)
	}
	count++

	rateLimitData[key] = fmt.Sprintf("%d", count)

	// 清理过期数据（保留24小时）
	cutoffHour := now.Add(-24*time.Hour).Truncate(time.Hour).Unix()
	for k := range rateLimitData {
		var hour int64
		if _, err := fmt.Sscanf(k, fmt.Sprintf("user_%d_%%d", userID), &hour); err == nil {
			if hour < cutoffHour {
				delete(rateLimitData, k)
			}
		}
	}

	// 保存更新后的数据
	dataBytes, _ := json.Marshal(rateLimitData)
	s.Store.UpsertWorkspaceSetting(ctx, &storepb.WorkspaceSetting{
		Key: storepb.WorkspaceSettingKey_AI_RATE_LIMIT,
		Value: &storepb.WorkspaceSetting_AIRateLimit{
			AIRateLimit: string(dataBytes),
		},
	})
}

func (s *APIV1Service) formatAISummaryContent(summary *SummaryResponse, req *SummaryRequest) string {
	var builder strings.Builder

	// 根据语言添加头部信息
	switch req.Language {
	case "zh", "zh-CN", "zh-TW":
		builder.WriteString("## 🤖 AI 总结\n\n")
		if req.TimeRange != "" {
			builder.WriteString(fmt.Sprintf("**总结范围**: %s\n\n", req.TimeRange))
		}
		builder.WriteString(fmt.Sprintf("**生成时间**: %s\n\n", time.Now().Format("2006-01-02 15:04:05")))
	else:
		builder.WriteString("## 🤖 AI Summary\n\n")
		if req.TimeRange != "" {
			builder.WriteString(fmt.Sprintf("**Summary Range**: %s\n\n", req.TimeRange))
		}
		builder.WriteString(fmt.Sprintf("**Generated**: %s\n\n", time.Now().Format("2006-01-02 15:04:05")))
	}

	// 添加总结内容
	builder.WriteString(summary.Content)

	// 添加标签
	builder.WriteString("\n\n#AI")
	if len(req.Tags) > 0 {
		for _, tag := range req.Tags {
			builder.WriteString(" #" + tag)
		}
	}

	return builder.String()
}
```

**定时任务（复用现有 cron 插件）**
```go
// 新文件：plugin/cron/ai_summary_job.go
package cron

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/usememos/memos/plugin/ai"
	"github.com/usememos/memos/store"
	storepb "github.com/usememos/memos/proto/gen/store"
)

type AISummaryJob struct {
	store     *store.Store
	aiService *ai.AIService
}

func NewAISummaryJob(store *store.Store) (*AISummaryJob, error) {
	aiService, err := ai.NewAIService(store)
	if err != nil {
		// AI 服务未配置是正常情况，不应该阻止任务创建
		slog.Warn("AI service not configured, auto summary disabled", "error", err)
		return &AISummaryJob{
			store:     store,
			aiService: nil,
		}, nil
	}

	return &AISummaryJob{
		store:     store,
		aiService: aiService,
	}, nil
}

func (j *AISummaryJob) Run(ctx context.Context) error {
	if j.aiService == nil {
		slog.Info("AI service not configured, skipping auto summary job")
		return nil
	}

	slog.Info("Starting AI auto summary job")

	// 1. 查询所有启用了自动总结的用户
	users, err := j.getUsersWithAutoSummary(ctx)
	if err != nil {
		slog.Error("Failed to get users with auto summary", "error", err)
		return err
	}

	if len(users) == 0 {
		slog.Info("No users with auto summary enabled")
		return nil
	}

	// 2. 逐个处理，错误隔离
	successCount := 0
	failureCount := 0

	for _, user := range users {
		if err := j.processUser(ctx, user); err != nil {
			slog.Error("Failed to generate auto summary for user", "user_id", user.ID, "username", user.Username, "error", err)
			failureCount++
			continue // 单个用户失败不影响其他用户
		}
		successCount++
	}

	slog.Info("AI auto summary job completed", "total_users", len(users), "success", successCount, "failures", failureCount)

	return nil
}

func (j *AISummaryJob) getUsersWithAutoSummary(ctx context.Context) ([]*store.User, error) {
	// 查询所有用户
	users, err := j.store.ListUsers(ctx, &store.FindUser{})
	if err != nil {
		return nil, err
	}

	var usersWithAutoSummary []*store.User
	for _, user := range users {
		// 检查用户是否启用了自动总结
		userSetting, err := j.store.GetUserSetting(ctx, &store.FindUserSetting{
			UserID: &user.ID,
			Key:    storepb.UserSettingKey_AI_AUTO_SUMMARY_FREQUENCY_DAYS.String(),
		})
		if err != nil {
			continue
		}

		if userSetting != nil && userSetting.GetAutoSummaryFrequencyDays() > 0 {
			usersWithAutoSummary = append(usersWithAutoSummary, user)
		}
	}

	return usersWithAutoSummary, nil
}

func (j *AISummaryJob) processUser(ctx context.Context, user *store.User) error {
	// 1. 检查用户上次总结时间
	lastSummary, err := j.getLastAutoSummaryTime(ctx, user.ID)
	if err != nil {
		return err
	}

	// 2. 获取用户设置的频率
	userSetting, err := j.store.GetUserSetting(ctx, &store.FindUserSetting{
		UserID: &user.ID,
		Key:    storepb.UserSettingKey_AI_AUTO_SUMMARY_FREQUENCY_DAYS.String(),
	})
	if err != nil {
		return err
	}

	if userSetting == nil || userSetting.GetAutoSummaryFrequencyDays() <= 0 {
		return nil // 用户未启用自动总结
	}

	frequency := userSetting.GetAutoSummaryFrequencyDays()

	// 3. 如果时间未到，跳过
	if time.Since(lastSummary) < time.Duration(frequency)*24*time.Hour {
		slog.Debug("Skipping auto summary for user, not enough time elapsed",
			"user_id", user.ID,
			"frequency_days", frequency,
			"last_summary", lastSummary.Format("2006-01-02 15:04"),
		)
		return nil
	}

	slog.Info("Generating auto summary for user",
		"user_id", user.ID,
		"username", user.Username,
		"frequency_days", frequency,
		"last_summary", lastSummary.Format("2006-01-02 15:04"),
	)

	// 4. 生成上一个周期的总结
	req := &ai.SummaryRequest{
		UserID:    user.ID,
		TimeRange: fmt.Sprintf("%dd", frequency),
		Language:  user.GetLocale(),
	}

	summary, err := j.aiService.GenerateSummaryWithRetry(ctx, req, 2)
	if err != nil {
		return err
	}

	// 5. 创建 AI Memo
	return j.createAIMemo(ctx, user.ID, summary, req)
}

func (j *AISummaryJob) getLastAutoSummaryTime(ctx context.Context, userID int32) (time.Time, error) {
	// 查询用户最新的 AI Memo
	memos, err := j.store.ListMemos(ctx, &store.FindMemo{
		CreatorID: &userID,
		RowStatus: &store.Normal,
		Limit:     &[]int32{1}[0],
	})
	if err != nil {
		return time.Time{}, err
	}

	// 查找最新的 AI Memo
	for _, memo := range memos {
		if j.isAIMemo(memo) {
			return time.Unix(memo.CreatedTs, 0), nil
		}
	}

	// 如果没有找到 AI Memo，返回很久以前的时间
	return time.Now().AddDate(0, 0, -365), nil
}

func (j *AISummaryJob) isAIMemo(memo *store.Memo) bool {
	return len(memo.Content) > 0 &&
		   (memo.Content[0] == '#' && memo.Content[1] == 'A' && memo.Content[2] == 'I') ||
		   (memo.Content[0] == '#' && memo.Content[1] == 'a' && memo.Content[2] == 'i')
}

func (j *AISummaryJob) createAIMemo(ctx context.Context, userID int32, summary *ai.SummaryResponse, req *ai.SummaryRequest) error {
	// 格式化总结内容
	content := j.formatAutoSummaryContent(summary, req)

	// 创建 Memo
	create := &store.Memo{
		UID:        generateUID(),
		CreatorID:  userID,
		Content:    content,
		Visibility: store.Private,
		Pinned:     false,
	}

	_, err := j.store.CreateMemo(ctx, create)
	if err != nil {
		return fmt.Errorf("failed to create AI memo: %w", err)
	}

	slog.Info("Auto AI summary created successfully",
		"user_id", userID,
		"frequency", req.TimeRange,
		"tokens_used", summary.TokenUsed,
		"duration", summary.Duration,
	)

	return nil
}

func (j *AISummaryJob) formatAutoSummaryContent(summary *ai.SummaryResponse, req *ai.SummaryRequest) string {
	var builder strings.Builder

	// 根据语言添加头部信息
	switch req.Language {
	case "zh", "zh-CN", "zh-TW":
		builder.WriteString("## 🤖 AI 自动总结\n\n")
		builder.WriteString(fmt.Sprintf("**总结周期**: %s\n\n", req.TimeRange))
		builder.WriteString(fmt.Sprintf("**生成时间**: %s\n\n", time.Now().Format("2006-01-02 15:04:05")))
		builder.WriteString("这是系统自动生成的备忘录总结。\n\n")
	default:
		builder.WriteString("## 🤖 AI Auto Summary\n\n")
		builder.WriteString(fmt.Sprintf("**Summary Period**: %s\n\n", req.TimeRange))
		builder.WriteString(fmt.Sprintf("**Generated**: %s\n\n", time.Now().Format("2006-01-02 15:04:05")))
		builder.WriteString("This is an automatically generated memo summary.\n\n")
	}

	// 添加总结内容
	builder.WriteString(summary.Content)

	// 添加标签
	builder.WriteString("\n\n#AI #auto-summary")

	return builder.String()
}

// 简单的 UID 生成器
func generateUID() string {
	return fmt.Sprintf("ai_summary_%d", time.Now().UnixNano())
}
```

### 3. 前端实现

**复用现有组件**
```tsx
// 扩展现有 MemoCard 组件
// web/src/components/MemoCard/MemoCard.tsx

interface MemoCardProps {
  memo: Memo;
  // 现有 props...
  isAIMemo?: boolean;        // 简单标识
  showGenerateButton?: boolean; // 只有最新 AI Memo 显示
  onGenerateSummary?: () => void;
}

export const MemoCard: React.FC<MemoCardProps> = ({
  memo,
  isAIMemo = false,
  showGenerateButton = false,
  onGenerateSummary,
  ...otherProps
}) => {
  const [sourceMemos, setSourceMemos] = useState<Memo[]>([]);
  const [showSourceMemos, setShowSourceMemos] = useState(false);

  // 检查是否为 AI Memo
  const checkIsAIMemo = (memo: Memo) => {
    return memo.content?.includes('#AI') || memo.content?.includes('#ai');
  };

  const isAIMemoCard = isAIMemo || checkIsAIMemo(memo);

  // 加载关联的 Source Memos
  useEffect(() => {
    if (isAIMemoCard && showSourceMemos) {
      loadSourceMemos(memo.name).then(setSourceMemos);
    }
  }, [isAIMemoCard, showSourceMemos, memo.name]);

  const handleEditClick = (e: React.MouseEvent) => {
    if (isAIMemoCard) {
      e.preventDefault();
      toast.error('AI 生成的总结不支持编辑');
      return;
    }
    // 正常的编辑逻辑
  };

  return (
    <div className={`memo-card ${isAIMemoCard ? 'ai-memo' : ''}`}>
      {/* AI Memo 顶部生成按钮（仅最新的 AI Memo 显示） */}
      {showGenerateButton && (
        <div className="ai-generate-section">
          <button
            onClick={onGenerateSummary}
            className="ai-generate-btn"
            disabled={generating}
          >
            {generating ? '🤖 生成中...' : '🤖 生成新总结'}
          </button>
        </div>
      )}

      {/* AI Memo 视觉标识 */}
      {isAIMemoCard && (
        <div className="ai-memo-indicator">
          🤖 AI 总结
        </div>
      )}

      {/* 现有的 MemoCard 内容 */}
      <MemoContent memo={memo} />

      {/* AI Memo 关联的 Source Memos */}
      {isAIMemoCard && (
        <div className="ai-source-memos-section">
          <button
            onClick={() => setShowSourceMemos(!showSourceMemos)}
            className="text-sm text-gray-600 hover:text-gray-800"
          >
            {showSourceMemos ? '隐藏' : '查看'}关联的备忘录 ({sourceMemos.length})
          </button>
          {showSourceMemos && (
            <div className="source-memos-list mt-2 space-y-1">
              {sourceMemos.map(sourceMemo => (
                <div
                  key={sourceMemo.name}
                  className="text-sm p-2 bg-gray-50 rounded cursor-pointer hover:bg-gray-100"
                  onClick={() => navigateToMemo(sourceMemo.name)}
                >
                  {sourceMemo.content.substring(0, 100)}...
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 现有的 MemoCard 操作（AI Memo 禁用编辑） */}
      <MemoActions memo={memo} onEditClick={isAIMemoCard ? handleEditClick : undefined} />
    </div>
  );
};
```

**生成总结对话框**
```tsx
// 新文件：web/src/components/GenerateSummaryDialog.tsx

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';

interface GenerateSummaryDialogProps {
  open: boolean;
  onConfirm: (params: SummaryParams) => void;
  onCancel: () => void;
  generating?: boolean;
}

interface SummaryParams {
  timeRange: string;
  tags: string[];
  startDate?: string;
  endDate?: string;
}

export const GenerateSummaryDialog: React.FC<GenerateSummaryDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  generating = false
}) => {
  const [params, setParams] = useState<SummaryParams>({
    timeRange: '7d',
    tags: [],
  });

  const [customDates, setCustomDates] = useState({
    startDate: '',
    endDate: '',
  });

  const timeRangeOptions = [
    { value: '7d', label: '最近 7 天' },
    { value: '30d', label: '最近 30 天' },
    { value: '90d', label: '最近 90 天' },
    { value: 'custom', label: '自定义范围' },
  ];

  const handleConfirm = () => {
    if (params.timeRange === 'custom') {
      onConfirm({
        ...params,
        startDate: customDates.startDate,
        endDate: customDates.endDate,
      });
    } else {
      onConfirm(params);
    }
  };

  const isValid = () => {
    if (params.timeRange === 'custom') {
      return customDates.startDate && customDates.endDate;
    }
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>🤖 生成 AI 总结</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 时间范围选择 */}
          <div>
            <label className="text-sm font-medium">总结范围</label>
            <select
              value={params.timeRange}
              onChange={(e) => setParams({ ...params, timeRange: e.target.value })}
              className="w-full mt-1 p-2 border rounded"
              disabled={generating}
            >
              {timeRangeOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* 自定义日期范围 */}
          {params.timeRange === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium">开始日期</label>
                <Input
                  type="date"
                  value={customDates.startDate}
                  onChange={(e) => setCustomDates({ ...customDates, startDate: e.target.value })}
                  disabled={generating}
                />
              </div>
              <div>
                <label className="text-sm font-medium">结束日期</label>
                <Input
                  type="date"
                  value={customDates.endDate}
                  onChange={(e) => setCustomDates({ ...customDates, endDate: e.target.value })}
                  disabled={generating}
                />
              </div>
            </div>
          )}

          {/* 标签筛选（可选） */}
          <div>
            <label className="text-sm font-medium">标签筛选（可选）</label>
            <Input
              placeholder="输入标签，用逗号分隔"
              value={params.tags.join(', ')}
              onChange={(e) => setParams({
                ...params,
                tags: e.target.value.split(',').map(tag => tag.trim()).filter(Boolean)
              })}
              disabled={generating}
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={onCancel} disabled={generating}>
              取消
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!isValid() || generating}
            >
              {generating ? '生成中...' : '开始生成'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
```

**设置页面扩展**
```tsx
// 工作空间 AI 配置（仅管理员可见）
// web/src/components/Settings/WorkspaceAIConfigSection.tsx

export const WorkspaceAIConfigSection: React.FC = () => {
  const [config, setConfig] = useState<AIConfig>({
    endpoint: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    systemPrompt: '请总结以下备忘录内容，提取关键主题、重要事件和待办事项。使用简洁的 Markdown 格式输出。',
  });

  const [testing, setTesting] = useState(false);

  const handleSave = async () => {
    try {
      await apiClient.updateAISummaryConfig(config);
      toast.success('AI 配置已保存');
    } catch (error) {
      toast.error('保存失败: ' + error.message);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await apiClient.testAIConfig(config);
      toast.success('AI 连接测试成功');
    } catch (error) {
      toast.error('连接测试失败: ' + error.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3>AI 服务配置</h3>

      <div>
        <label>API 端点</label>
        <Input
          value={config.endpoint}
          onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
          placeholder="https://api.openai.com/v1"
        />
      </div>

      <div>
        <label>API 密钥</label>
        <Input
          type="password"
          value={config.apiKey}
          onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
          placeholder="sk-..."
        />
      </div>

      <div>
        <label>模型名称</label>
        <Input
          value={config.model}
          onChange={(e) => setConfig({ ...config, model: e.target.value })}
          placeholder="gpt-4o-mini"
        />
      </div>

      <div>
        <label>系统提示词</label>
        <textarea
          className="w-full h-24 p-2 border rounded"
          value={config.systemPrompt}
          onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
        />
      </div>

      <div className="flex space-x-2">
        <Button onClick={handleSave}>保存配置</Button>
        <Button variant="outline" onClick={handleTest} disabled={testing}>
          {testing ? '测试中...' : '测试连接'}
        </Button>
      </div>
    </div>
  );
};

// 用户自动总结设置
// web/src/components/Settings/UserAISettingsSection.tsx

export const UserAISettingsSection: React.FC = () => {
  const [frequency, setFrequency] = useState(7);

  const handleSave = async () => {
    try {
      await apiClient.updateUserAISettings({ autoSummaryFrequencyDays: frequency });
      toast.success('设置已保存');
    } catch (error) {
      toast.error('保存失败: ' + error.message);
    }
  };

  return (
    <div className="space-y-4">
      <h3>AI 总结设置</h3>

      <div>
        <label>自动总结频率（天）</label>
        <select
          value={frequency}
          onChange={(e) => setFrequency(parseInt(e.target.value))}
          className="w-full p-2 border rounded"
        >
          <option value={1}>每天</option>
          <option value={3}>每 3 天</option>
          <option value={7}>每周</option>
          <option value={14}>每 2 周</option>
          <option value={30}>每月</option>
        </select>
        <p className="text-sm text-gray-500 mt-1">
          系统将按设定的频率自动生成您的备忘录总结
        </p>
      </div>

      <Button onClick={handleSave}>保存设置</Button>
    </div>
  );
};
```

### 4. API 设计

**扩展现有 gRPC API**
```protobuf
// 在 proto/api/v1/service.proto 添加

service APIV1Service {
  // ... 现有 methods

  // AI 总结相关 API
  rpc GenerateAISummary(GenerateAISummaryRequest) returns (Memo);
  rpc GetAISummaryConfig(GetAISummaryConfigRequest) returns (AISummaryConfig);
  rpc UpdateAISummaryConfig(UpdateAISummaryConfigRequest) returns (AISummaryConfig);
  rpc TestAIConfig(TestAIConfigRequest) returns (TestAIConfigResponse);
}

message GenerateAISummaryRequest {
  string time_range = 1;     // "7d", "30d", "90d", "custom"
  repeated string tags = 2;  // 标签筛选
  string start_date = 3;     // 自定义开始时间 (YYYY-MM-DD)
  string end_date = 4;       // 自定义结束时间 (YYYY-MM-DD)
}

message AISummaryConfig {
  string endpoint = 1;           // API 端点
  string api_key = 2;            // API 密钥
  string model = 3;              // 模型名称
  string system_prompt = 4;      // 系统提示词
}

message GetAISummaryConfigRequest {}

message UpdateAISummaryConfigRequest {
  AISummaryConfig config = 1;
}

message TestAIConfigRequest {
  AISummaryConfig config = 1;
}

message TestAIConfigResponse {
  bool success = 1;
  string message = 2;
}

// 扩展现有枚举
enum WorkspaceSettingKey {
  // ... 现有 keys
  AI_CONFIG = 15;
  AI_RATE_LIMIT = 16;
}

enum UserSettingKey {
  // ... 现有 keys
  AI_AUTO_SUMMARY_FREQUENCY_DAYS = 12;
}

// 扩展现有设置消息
message WorkspaceSetting {
  WorkspaceSettingKey key = 1;
  oneof value {
    // ... 现有 value types
    string ai_config = 15;
    string ai_rate_limit = 16;
  }
}

message UserSetting {
  UserSettingKey key = 1;
  oneof value {
    // ... 现有 value types
    int32 auto_summary_frequency_days = 12;
  }
}
```

### 5. 错误处理与降级

**Linus 原则：永不破坏主功能**

```go
// 错误处理策略
func (s *APIV1Service) GenerateAISummary(ctx context.Context, request *v1pb.GenerateAISummaryRequest) (*v1pb.Memo, error) {
    // 1. 配置检查 -> 友好错误提示
    aiConfig, err := getAIConfig(s.Store)
    if err != nil {
        slog.Error("Failed to get AI config", "error", err)
        return nil, status.Errorf(codes.Internal, "AI service temporarily unavailable")
    }

    if aiConfig.APIKey == "" {
        return nil, status.Errorf(codes.FailedPrecondition, "AI service not configured. Please contact workspace administrator.")
    }

    // 2. 限流检查 -> 用户友好的提示
    if !s.checkRateLimit(user.ID) {
        return nil, status.Errorf(codes.ResourceExhausted, "You have reached the maximum number of AI summaries (5 per hour). Please try again later.")
    }

    // 3. API 调用 -> 30秒超时，重试2次
    summary, err := aiService.GenerateSummaryWithRetry(ctx, req, 2)
    if err != nil {
        slog.Error("AI summary generation failed", "user_id", user.ID, "error", err)

        // 根据错误类型返回不同的提示
        if strings.Contains(err.Error(), "rate limit") {
            return nil, status.Errorf(codes.ResourceExhausted, "AI service rate limit exceeded. Please try again later.")
        } else if strings.Contains(err.Error(), "timeout") {
            return nil, status.Errorf(codes.DeadlineExceeded, "AI service timeout. Please try again later.")
        } else {
            return nil, status.Errorf(codes.Internal, "AI service temporarily unavailable. Please try again later.")
        }
    }

    // 4. 内容验证 -> 确保质量
    if len(strings.TrimSpace(summary.Content)) < 100 {
        return nil, status.Errorf(codes.Internal, "Generated summary is too short. Please try again.")
    }

    if len(summary.Content) > 5000 {
        return nil, status.Errorf(codes.Internal, "Generated summary is too long. Please try again.")
    }

    // 5. 后续处理 -> 即使 AI 失败，用户仍可正常使用其他功能
    return s.createAIMemo(ctx, summary)
}

// 降级处理：在 MemoList 中显示配置引导
const MemoList: React.FC = () => {
  const [aiConfigured, setAiConfigured] = useState(true);

  useEffect(() => {
    checkAIConfig().then(setAiConfigured);
  }, []);

  return (
    <div>
      {!aiConfigured && (
        <div className="ai-config-notice">
          🤖 AI 总结功能未配置，请联系管理员配置
          <Button size="sm" variant="outline">
            了解更多
          </Button>
        </div>
      )}

      {/* 现有的 MemoList 内容 */}
    </div>
  );
};
```

### 6. 国际化实现

**复用现有 i18n 架构**

```json
// web/src/locales/zh-CN.json
{
  "ai": {
    "generate-summary": "生成新总结",
    "generating": "正在生成总结...",
    "generate-summary-title": "🤖 生成 AI 总结",
    "summary-range": "总结范围",
    "recent-7d": "最近 7 天",
    "recent-30d": "最近 30 天",
    "recent-90d": "最近 90 天",
    "custom-range": "自定义范围",
    "start-date": "开始日期",
    "end-date": "结束日期",
    "tag-filter": "标签筛选（可选）",
    "tag-filter-placeholder": "输入标签，用逗号分隔",
    "start-generating": "开始生成",
    "cancel": "取消",
    "ai-config": "AI 配置",
    "api-endpoint": "API 端点",
    "api-key": "API 密钥",
    "model-name": "模型名称",
    "system-prompt": "系统提示词",
    "save-config": "保存配置",
    "test-connection": "测试连接",
    "testing": "测试中...",
    "test-success": "AI 连接测试成功",
    "test-failed": "连接测试失败",
    "auto-summary-frequency": "自动总结频率",
    "frequency-days": "天",
    "daily": "每天",
    "weekly": "每周",
    "bi-weekly": "每 2 周",
    "monthly": "每月",
    "auto-summary-description": "系统将按设定的频率自动生成您的备忘录总结",
    "save-settings": "保存设置",
    "rate-limit-exceeded": "总结生成过于频繁，请稍后再试（每小时最多 5 次）",
    "ai-service-error": "AI 服务暂时不可用，请稍后重试",
    "ai-not-configured": "AI 服务未配置，请联系管理员配置",
    "learn-more": "了解更多",
    "summary-too-short": "生成的总结过短，请重试",
    "summary-too-long": "生成的总结过长，请重试",
    "timeout-error": "AI 服务响应超时，请重试",
    "empty-response": "AI 服务返回空响应，请重试"
  }
}

// web/src/locales/en-US.json
{
  "ai": {
    "generate-summary": "Generate New Summary",
    "generating": "Generating summary...",
    "generate-summary-title": "🤖 Generate AI Summary",
    "summary-range": "Summary Range",
    "recent-7d": "Last 7 days",
    "recent-30d": "Last 30 days",
    "recent-90d": "Last 90 days",
    "custom-range": "Custom Range",
    "start-date": "Start Date",
    "end-date": "End Date",
    "tag-filter": "Tag Filter (Optional)",
    "tag-filter-placeholder": "Enter tags separated by commas",
    "start-generating": "Start Generating",
    "cancel": "Cancel",
    "ai-config": "AI Configuration",
    "api-endpoint": "API Endpoint",
    "api-key": "API Key",
    "model-name": "Model Name",
    "system-prompt": "System Prompt",
    "save-config": "Save Config",
    "test-connection": "Test Connection",
    "testing": "Testing...",
    "test-success": "AI connection test successful",
    "test-failed": "Connection test failed",
    "auto-summary-frequency": "Auto Summary Frequency",
    "frequency-days": "days",
    "daily": "Daily",
    "weekly": "Weekly",
    "bi-weekly": "Bi-weekly",
    "monthly": "Monthly",
    "auto-summary-description": "System will automatically generate memo summaries based on your frequency setting",
    "save-settings": "Save Settings",
    "rate-limit-exceeded": "Summary generation too frequent, please try again later (5 times per hour maximum)",
    "ai-service-error": "AI service temporarily unavailable, please try again later",
    "ai-not-configured": "AI service not configured, please contact administrator",
    "learn-more": "Learn More",
    "summary-too-short": "Generated summary is too short, please try again",
    "summary-too-long": "Generated summary is too long, please try again",
    "timeout-error": "AI service response timeout, please try again",
    "empty-response": "AI service returned empty response, please try again"
  }
}
```

## 实施步骤

### 第一阶段：数据基础（1天）
1. **扩展 Protocol Buffers**
   - 在 `proto/store/workspace_setting.proto` 添加 `AI_CONFIG` 和 `AI_RATE_LIMIT` 枚举
   - 在 `proto/store/user_setting.proto` 添加 `AI_AUTO_SUMMARY_FREQUENCY_DAYS` 枚举
   - 运行 `buf generate` 重新生成代码

2. **实现配置 API**
   - 扩展 `workspace_setting.go` 添加 AI 配置支持
   - 扩展 `user_setting.go` 添加自动总结频率支持
   - 在 `api/v1/workspace_service.go` 添加 AI 配置 CRUD API

### 第二阶段：核心功能（2天）
1. **AI 服务实现**
   - 创建 `server/ai/ai_service.go`
   - 实现 OpenAI 集成和总结生成逻辑
   - 添加重试机制和错误处理

2. **API 端点实现**
   - 在 `api/v1/memo_service.go` 添加 `GenerateAISummary` 方法
   - 实现限流检查和更新逻辑
   - 添加权限验证和错误处理

3. **前端核心功能**
   - 创建 `GenerateSummaryDialog` 组件
   - 扩展 `MemoCard` 添加 AI 标识和生成按钮
   - 在 `memoStore` 添加生成总结的 action

### 第三阶段：用户体验（1天）
1. **设置页面**
   - 创建 `WorkspaceAIConfigSection` 组件（管理员配置）
   - 创建 `UserAISettingsSection` 组件（用户设置）
   - 集成到现有设置页面

2. **视觉优化**
   - 添加 AI Memo 的特殊样式
   - 实现加载状态和错误提示
   - 优化移动端体验

3. **国际化**
   - 在所有语言文件中添加 AI 相关翻译
   - 实现动态语言切换支持

### 第四阶段：自动化（1天）
1. **定时任务**
   - 创建 `plugin/cron/ai_summary_job.go`
   - 实现用户频率检查和批量处理
   - 添加错误隔离和日志记录

2. **调度配置**
   - 在现有 cron 调度器中注册 AI 总结任务
   - 配置合适的执行频率（如每小时执行一次）

### 第五阶段：测试与优化（1天）
1. **错误场景测试**
   - AI API 调用失败
   - 网络超时
   - 配置缺失
   - 限流触发

2. **性能优化**
   - API 响应时间优化
   - 前端加载状态优化
   - 数据库查询优化

3. **文档完善**
   - 更新 API 文档
   - 编写用户使用指南
   - 添加管理员配置说明

## 关键优势

✅ **零破坏性**：完全复用现有架构，失败不影响核心功能
✅ **最小复杂度**：不引入新的数据表或特殊实体，AI Memo 就是普通 Memo
✅ **渐进实现**：每个阶段都可独立部署和回滚
✅ **符合 Linus 哲学**：数据结构清晰，没有特殊情况
✅ **真实需求驱动**：严格按照 requirement.md 实现，不过度设计
✅ **国际化支持**：完整的多语言支持
✅ **错误降级**：AI 服务失败不影响主功能

这个方案基于真实需求，避免了过度设计，同时确保功能的完整性和用户体验。