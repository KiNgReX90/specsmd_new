(function () {
  var themeKey = 'specsmd:webview-state';

  function readTheme() {
    try {
      var stored = localStorage.getItem(themeKey);
      if (stored === '"dark"' || stored === 'dark') {
        return 'dark';
      }
      if (stored === '"light"' || stored === 'light') {
        return 'light';
      }
      var parsed = JSON.parse(stored);
      if (parsed === 'dark' || parsed === 'light') {
        return parsed;
      }
    } catch (error) {
      return 'dark';
    }

    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }

  document.documentElement.dataset.host = 'dashboard-web';
  applyTheme(readTheme());

  window.addEventListener('storage', function (event) {
    if (event.key !== themeKey) {
      return;
    }

    applyTheme(readTheme());
  });

  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'setData') {
      document.documentElement.dataset.loaded = 'true';
    }
  });
}());
