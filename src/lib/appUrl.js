// Public base URL of the web app, used to build share/public links.
// Set APP_BASE_URL in the deployment environment (e.g. https://kue.arshii.net).
export function appBaseUrl() {
  return (process.env.APP_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
}
