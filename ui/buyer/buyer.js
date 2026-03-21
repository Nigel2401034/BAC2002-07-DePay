async function loadBuyerNavbar() {
  const mount = document.getElementById("buyerNavbarMount");
  if (!mount) return;

  try {
    const response = await fetch("./navbar.html", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load navbar (${response.status})`);
    }

    const navbarHtml = await response.text();
    mount.innerHTML = navbarHtml;

    if (window.initBuyerNavbar) {
      window.initBuyerNavbar(document);
    }
  } catch (error) {
    mount.innerHTML = '<div class="seller-navbar"><div class="seller-nav-left"><p class="kicker seller-kicker">DePay Buyer</p></div></div>';
    console.error("Navbar load error:", error.message);
  }
}

document.addEventListener("DOMContentLoaded", loadBuyerNavbar);