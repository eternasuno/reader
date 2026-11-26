try {
  var theme = localStorage.getItem('reader.theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  }
} catch {}
