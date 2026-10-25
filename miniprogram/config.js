// 默认微信云开发；DATA_MODE 改为 'http' 时使用 API_BASE。AppSecret 只能保存在服务端。
module.exports = {
  DATA_MODE: 'cloud',
  CLOUD_ENV: '',
  CLOUD_FUNCTION_NAME: 'mindTrace',
  API_BASE: 'https://your-api.example.com/api/v1',
  REQUEST_TIMEOUT: 12000,
  QUICK_DRAFT_KEY: 'mind_trace_quick_draft_v1',
  OFFLINE_QUEUE_KEY: 'mind_trace_offline_records_v1',
  EVALUATION_DRAFT_PREFIX: 'mind_trace_evaluation_draft_v1_'
};
