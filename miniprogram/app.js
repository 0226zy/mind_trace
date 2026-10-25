const auth = require('./services/auth');
const sync = require('./services/sync');
const config = require('./config');
const { initializeCloud } = require('./services/cloud-transport');

App({
  globalData: { user: null, networkConnected: true, deletionEpoch: 0, initializationError: '' },

  onLaunch() {
    if (config.DATA_MODE === 'cloud') {
      try {
        initializeCloud(wx, config.CLOUD_ENV);
      } catch (error) {
        this.globalData.initializationError = error.message;
        wx.showToast({ title: error.message, icon: 'none', duration: 5000 });
        return;
      }
    }
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
