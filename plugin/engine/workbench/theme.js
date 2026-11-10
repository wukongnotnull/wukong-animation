try {
  var theme = localStorage.getItem('wka-workbench-theme');
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
} catch (e) {
  document.documentElement.dataset.theme = 'dark';
}
