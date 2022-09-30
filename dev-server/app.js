const serveDev = require('./serve-dev');
const servePackage = require('./serve-package');
const serveSidebar = require('./serve-sidebar');

servePackage(3001);
serveDev(3002, { clientUrl: `//{current_host}:3001/hypothesis` });
serveSidebar(5000, { clientUrl: `//{current_host}:3001/hypothesis` });