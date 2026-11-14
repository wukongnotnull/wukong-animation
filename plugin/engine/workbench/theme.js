try {
  var theme = localStorage.getItem('wka-workbench-theme');
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
} catch (e) {
  document.documentElement.dataset.theme = 'light';
}
