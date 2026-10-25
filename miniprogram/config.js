// 部署时仅修改 API_BASE；AppSecret 只能保存在服务端，禁止写入小程序。
module.exports = {
  API_BASE: 'https://your-api.example.com/api/v1',
  REQUEST_TIMEOUT: 12000,
  QUICK_DRAFT_KEY: 'mind_trace_quick_draft_v1',
  OFFLINE_QUEUE_KEY: 'mind_trace_offline_records_v1',
  EVALUATION_DRAFT_PREFIX: 'mind_trace_evaluation_draft_v1_'
};
