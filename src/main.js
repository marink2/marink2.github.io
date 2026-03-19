const currentPage = document.body.dataset.page;

for (const link of document.querySelectorAll(".nav-links a")) {
  const href = link.getAttribute("href");
  if (!href) {
    continue;
  }

  const pageName = href.replace(".html", "");
  const normalizedCurrent = currentPage === "home" ? "index" : currentPage;

  if (pageName === normalizedCurrent) {
    link.classList.add("is-active");
    link.setAttribute("aria-current", "page");
  }
}
