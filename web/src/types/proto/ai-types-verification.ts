/**
 * AI Service Types Verification
 * 
 * This file verifies that all AI-related Protocol Buffer types are correctly generated.
 * It serves as a type-checking reference and can be deleted after verification.
 */

// AI Service types
import type {
  GenerateAISummaryRequest,
  TestAIConfigRequest,
  TestAIConfigResponse,
  GetMemoSourceMemosRequest,
  GetMemoSourceMemosResponse,
} from "./api/v1/ai_service";

import { AIServiceDefinition } from "./api/v1/ai_service";

// Workspace setting types
import {
  WorkspaceSetting_Key,
  type WorkspaceSetting_AISetting,
} from "./api/v1/workspace_service";

// User setting types
import {
  UserSetting_Key,
  type UserSetting_AIAutoSummarySetting,
} from "./api/v1/user_service";

// Memo type
import type { Memo } from "./api/v1/memo_service";

/**
 * Verify AI Service request/response types
 */
export function verifyAIServiceTypes() {
  // GenerateAISummary types
  const summaryRequest: GenerateAISummaryRequest = {
    timeRange: "7d",
    tags: ["work", "personal"],
    startDate: "2024-01-01",
    endDate: "2024-01-31",
  };

  // TestAIConfig types
  const testRequest: TestAIConfigRequest = {};
  const testResponse: TestAIConfigResponse = {
    success: true,
    errorMessage: "",
    details: "Connection successful",
  };

  // GetMemoSourceMemos types
  const sourceMemosRequest: GetMemoSourceMemosRequest = {
    name: "memos/123",
    pageSize: 50,
    pageToken: "",
  };

  const sourceMemosResponse: GetMemoSourceMemosResponse = {
    memos: [],
    nextPageToken: "",
    totalSize: 0,
  };

  console.log("✅ AI Service types verified");
}

/**
 * Verify Workspace Setting types
 */
export function verifyWorkspaceSettingTypes() {
  // Workspace setting keys
  const aiConfigKey: WorkspaceSetting_Key = WorkspaceSetting_Key.AI_CONFIG;
  const aiRateLimitKey: WorkspaceSetting_Key = WorkspaceSetting_Key.AI_RATE_LIMIT;

  // AI Setting
  const aiSetting: WorkspaceSetting_AISetting = {
    endpoint: "https://api.openai.com/v1",
    apiKey: "sk-...",
    model: "gpt-4o-mini",
    systemPrompt: "You are a helpful assistant.",
  };

  console.log("✅ Workspace Setting types verified");
}

/**
 * Verify User Setting types
 */
export function verifyUserSettingTypes() {
  // User setting key
  const aiAutoSummaryKey: UserSetting_Key = UserSetting_Key.AI_AUTO_SUMMARY;

  // AI Auto Summary Setting
  const aiAutoSummarySetting: UserSetting_AIAutoSummarySetting = {
    frequencyDays: 7,
    enabled: true,
    failureCount: 0,
  };

  console.log("✅ User Setting types verified");
}

/**
 * Verify AI Service Definition
 */
export function verifyAIServiceDefinition() {
  const serviceName = AIServiceDefinition.name;
  const methods = AIServiceDefinition.methods;

  // Verify method names
  const hasGenerateAISummary = "generateAISummary" in methods;
  const hasTestAIConfig = "testAIConfig" in methods;
  const hasGetMemoSourceMemos = "getMemoSourceMemos" in methods;

  if (!hasGenerateAISummary || !hasTestAIConfig || !hasGetMemoSourceMemos) {
    throw new Error("AI Service methods not found");
  }

  console.log("✅ AI Service Definition verified");
}

/**
 * Run all verifications
 */
export function runAllVerifications() {
  console.log("🔍 Verifying AI Service Protocol Buffer types...\n");

  verifyAIServiceTypes();
  verifyWorkspaceSettingTypes();
  verifyUserSettingTypes();
  verifyAIServiceDefinition();

  console.log("\n✅ All AI Service types are correctly generated!");
}

// Export types for use in other files
export type {
  GenerateAISummaryRequest,
  TestAIConfigRequest,
  TestAIConfigResponse,
  GetMemoSourceMemosRequest,
  GetMemoSourceMemosResponse,
  WorkspaceSetting_AISetting,
  UserSetting_AIAutoSummarySetting,
};
