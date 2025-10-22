import { aiServiceClient } from "@/grpcweb";
import type {
  GenerateAISummaryRequest,
  GetMemoSourceMemosRequest,
  GetMemoSourceMemosResponse,
  TestAIConfigResponse,
} from "@/types/proto/api/v1/ai_service";
import type { Memo } from "@/types/proto/api/v1/memo_service";

/**
 * AI Service - 封装 AI 相关的 gRPC 调用
 */
class AIService {
  /**
   * 生成 AI 总结
   * @param request 总结请求参数
   * @returns 生成的 AI Memo
   */
  async generateAISummary(request: GenerateAISummaryRequest): Promise<Memo> {
    return await aiServiceClient.generateAISummary(request);
  }

  /**
   * 测试 AI 配置
   * @returns 测试结果
   */
  async testAIConfig(): Promise<TestAIConfigResponse> {
    return await aiServiceClient.testAIConfig({});
  }

  /**
   * 获取 AI Memo 的源 Memos
   * @param request 查询请求参数
   * @returns 源 Memos 列表
   */
  async getMemoSourceMemos(request: GetMemoSourceMemosRequest): Promise<GetMemoSourceMemosResponse> {
    return await aiServiceClient.getMemoSourceMemos(request);
  }
}

export default new AIService();
