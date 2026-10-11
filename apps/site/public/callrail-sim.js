/* CallRail DNI SIMULATOR for local tests. This is NOT CallRail's script and does not talk to CallRail.
   It reproduces the documented behaviour that matters for the site integration (support.callrail.com and apidocs.callrail.com, read 2026-10-11):
   - swaps visible phone numbers and tel: links in the browser, never in the served HTML;
   - a pool source of "All Except Direct & Organic" swaps only tracked visits (paid campaign parameters or a non-search referrer);
   - elements marked data-calltrk-noswap (and their children) are never swapped;
   - CallTrk.swap(nodeOrSelector) rescans a node; elements added later are NOT picked up until swap() is called;
   - CallTrk.getSwapNumbers([numbers], cb) returns tracking numbers so a framework can render them itself. */
(function () {
  var POOL = "+1-778-555-0190";
  var REAL = /\(?\b604\)?[-. ]?555[-. ]?0142\b/g;
  var SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo)\./i;

  function tracked() {
    var q = new URLSearchParams(location.search);
    if (q.get("gclid") || q.get("wbraid") || q.get("gbraid") || q.get("msclkid") || (q.get("utm_medium") || "").match(/cpc|ppc|paid/i)) return true;
    try {
      if (document.referrer) { var h = new URL(document.referrer).hostname; if (h !== location.hostname && !SEARCH.test(h)) return true; }
    } catch (e) {}
    return false;
  }

  function format(pool) { var d = pool.replace(/\D/g, "").slice(1); return d.slice(0, 3) + " " + d.slice(3, 6) + "-" + d.slice(6); }

  function swapNode(root) {
    if (!window.__calltrkTracked) return 0;
    var n = 0;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach(function (t) {
      if (t.parentElement && t.parentElement.closest("[data-calltrk-noswap],script,style")) return;
      if (REAL.test(t.nodeValue)) { REAL.lastIndex = 0; t.nodeValue = t.nodeValue.replace(REAL, format(POOL)); n++; }
      REAL.lastIndex = 0;
    });
    (root.querySelectorAll ? root.querySelectorAll("a[href^='tel:']") : []).forEach(function (a) {
      if (a.closest("[data-calltrk-noswap]")) return;
      if (a.getAttribute("href").replace(/\D/g, "").slice(-10) === "6045550142") { a.setAttribute("href", "tel:" + POOL); n++; }
    });
    return n;
  }

  window.__calltrkTracked = tracked();
  window.CallTrk = {
    swap: function (nodeOrSelector) {
      var el = typeof nodeOrSelector === "string" ? document.querySelector(nodeOrSelector) : nodeOrSelector;
      return swapNode(el || document.body);
    },
    getSwapNumbers: function (numbers, cb) {
      cb(window.__calltrkTracked ? numbers.map(function () { return POOL.replace(/\D/g, ""); }) : numbers);
    },
  };
  function run() { swapNode(document.body); document.documentElement.setAttribute("data-calltrk-sim", window.__calltrkTracked ? "tracked" : "untracked"); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
