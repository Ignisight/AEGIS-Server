const sanitize = (str) => {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
};
