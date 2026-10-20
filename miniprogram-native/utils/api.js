const TOKEN_KEY = "tesla_miniprogram_token";

function request(path, options = {}) {
  const token = wx.getStorageSync(TOKEN_KEY);
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getApp().globalData.apiBase}/${path}`,
      method: options.method || "GET",
      data: options.data || {},
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success(response) {
        if (response.statusCode === 401) {
          wx.removeStorageSync(TOKEN_KEY);
          reject(new Error("连接已过期，请重新连接 Tesla 车况"));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(response.data?.error || "读取失败，请稍后重试"));
          return;
        }
        resolve(response.data);
      },
      fail() { reject(new Error("网络暂时不可用，请检查网络后重试")); }
    });
  });
}

module.exports = {
  TOKEN_KEY,
  request,
  saveToken(token) { wx.setStorageSync(TOKEN_KEY, token.trim()); },
  hasToken() { return Boolean(wx.getStorageSync(TOKEN_KEY)); },
  removeToken() { wx.removeStorageSync(TOKEN_KEY); }
};
