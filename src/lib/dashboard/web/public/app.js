(function () {
  document.documentElement.dataset.host = 'dashboard-web';

  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'setData') {
      document.documentElement.dataset.loaded = 'true';
    }
  });
}());
