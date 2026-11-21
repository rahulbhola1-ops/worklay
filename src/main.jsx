import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import '../styles.css';

function App() {
  useEffect(() => {
    import('../app.js');
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <a href="#/" className="logo" aria-label="Worklay home">
            <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M7 10l4 13 5-9 5 9 4-13" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span>worklay</span>
          </a>
          <nav className="mainnav" id="mainnav">
            <a href="#/freelancers" data-i18n="nav.freelancers">Find freelancers</a>
            <a href="#/projects" data-i18n="nav.projects">Projects</a>
            <a href="#/services" data-i18n="nav.services">Services</a>
            <a href="#/blog" data-i18n="nav.blog">Blog</a>
            <a href="#/about" data-i18n="nav.about">About</a>
            <a href="#/contact" data-i18n="nav.contact">Contact</a>
          </nav>
          <div className="topbar-actions" id="topbar-actions"></div>
          <button className="burger" id="burger" aria-label="Menu">☰</button>
        </div>
      </header>

      <main id="app" className="app"></main>

      <footer className="footer">
        <div className="container footer-grid">
          <div>
            <a href="#/" className="logo logo-light"><svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M7 10l4 13 5-9 5 9 4-13" fill="none" stroke="#3858FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg><span>worklay</span></a>
            <p className="muted-light" data-i18n="footer.tag">Connecting people with tasks to the professionals who get them done.</p>
          </div>
          <div><h4 data-i18n="footer.platform">Platform</h4><a href="#/freelancers" data-i18n="nav.freelancers">Find freelancers</a><a href="#/projects" data-i18n="nav.projects">Projects</a><a href="#/services" data-i18n="nav.services">Services</a><a href="#/post-project" data-i18n="cta.post">Post a project</a></div>
          <div><h4 data-i18n="footer.company">Company</h4><a href="#/about" data-i18n="nav.about">About</a><a href="#/blog" data-i18n="nav.blog">Blog</a><a href="#/contact" data-i18n="nav.contact">Contact</a></div>
        </div>
        <div className="container footer-bottom">© <span id="year"></span> Worklay</div>
      </footer>

      <nav className="tabbar" id="tabbar" aria-label="Quick navigation"></nav>
      <div id="modal-root"></div>
      <div id="toasts" className="toasts" aria-live="polite"></div>
    </>
  );
}

const rootRoute = createRootRoute({ component: App });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
