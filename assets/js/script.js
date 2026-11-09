import('./controllers/LoginController.js').then(({ LoginController }) => {
  const login = new LoginController();
  login.initialize();
}).catch(() => {
  const error = document.querySelector('#passwordError');
  if (error) error.textContent = 'Unable to load sign-in. Check your connection and refresh Presence.';
});
