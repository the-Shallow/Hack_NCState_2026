const urlParams = new URLSearchParams(window.location.search);
const userCode = urlParams.get('code');
document.getElementById('code').textContent = userCode || 'No Code Found';