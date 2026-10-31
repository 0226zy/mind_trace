Component({
  options: { styleIsolation: 'shared' },
  properties: {
    loading: Boolean,
    loadingText: String,
    error: String,
    empty: Boolean,
    emptyTitle: String,
    emptyText: String
  },
  methods: {
    onRetry() { this.triggerEvent('retry'); }
  }
});
