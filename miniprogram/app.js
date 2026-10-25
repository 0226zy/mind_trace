const auth = require('./services/auth');
const sync = require('./services/sync');

App({
  globalData: { user: null, networkConnected: true, deletionEpoch: 0 },

  onLaunch() {
    sync.recoverInterruptedQueue();
    this.loginInBackground();
    wx.getNetworkType({
      success: (res) => { this.globalData.networkConnected = res.networkType !== 'none'; }
    });
    wx.onNetworkStatusChange((res) => {
      this.globalData.networkConnected = res.isConnected;
      if (res.isConnected) sync.flushQueue();
    });
  },

  loginInBackground() {
    return auth.ensureLogin().then((user) => {
      this.globalData.user = user;
      sync.reconcileAccount(user);
      sync.flushQueue(user);
      return user;
    }).catch(() => null);
  }
});
