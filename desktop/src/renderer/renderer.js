window.api.version().then((v) => {
  document.getElementById("version").textContent = `Versi ${v}`;
});
