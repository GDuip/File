//No import statement needed
const DOMPurify = window.DOMPurify;

// --- Constants ---
const MAX_TABS = 20;
const MAX_HISTORY_ENTRIES = 100;
const DEFAULT_SEARCH_ENGINE = 'brave';
const DEFAULT_LANGUAGE = 'en';
const URL_REGEX = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
// Establish websocket connection
const socket = new WebSocket("wss://api.whitebit.com/ws");
 
// Set up periodic ping
setInterval(() => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
            id: 0,
            method: "ping",
            params: [],
        }));
  }
}, 50000); // Every 50 seconds
const DEBOUNCE_DELAY = 300; // Delay for debouncing search input

// --- DOM Element References ---
const dom = {
    searchInput: document.getElementById('url'),
    historyList: document.getElementById('historyList'),
    themeToggle: document.getElementById('themeToggle'),
    historyButton: document.getElementById('historyButton'),
    historyDropdown: document.getElementById('historyDropdown'),
    clearHistoryBtn: document.getElementById('clearHistory'),
    settingsButton: document.getElementById('settingsButton'),
    settingsMenu: document.getElementById('settingsMenu'),
    closeSettings: document.getElementById('closeSettings'),
    searchEngineSelect: document.getElementById('searchEngineSelect'),
    searchIcon: document.getElementById('searchIcon'),
    suggestionList: document.getElementById('url-suggestions'),
    reloadBtn: document.getElementById('reloadBtn'),
    bookmarkBtn: document.getElementById('bookmarkBtn'),
    tabsContainer: document.getElementById("tabs"),
    browsers: document.getElementById("browsers"),
    back: document.getElementById('back'),
    forward: document.getElementById('forward'),
    controls: document.getElementById('controls'),
    bookmarksDropdown: document.getElementById('bookmarksDropdown'),
    bookmarksList: document.getElementById('bookmarksList'),
    findInPageInput: document.getElementById('findInPageInput'), // Added for Find in Page
    findInPageContainer: document.getElementById('findInPageContainer'), // Added for Find in Page
};

// --- Data Structures ---
class Tab { // Using a class for better organization
    constructor(id, iframe, button, history = [], historyIndex = -1, isPinned = false, groupId = null) {
        this.id = id;
        this.iframe = iframe;
        this.button = button;
        this.history = history;
        this.historyIndex = historyIndex;
        this.isPinned = isPinned;
        this.groupId = groupId; // For tab grouping (advanced feature)
    }
}

let tabs = new Map(); // tabId -> Tab object
let bookmarks = new Map(); // url -> { title, addedDate }
let activeTabId = null;
let tabGroups = new Map();  // groupId -> [tabId1, tabId2, ...] (for tab grouping)


// --- Utility Functions ---
function isValidUrl(urlString) {
    try {
        const url = new URL(urlString);
        return (url.protocol === 'http:' || url.protocol === 'https:') && URL_REGEX.test(urlString);
    } catch (_) {
        return false;
    }
}

// Debounce function for input handling
function debounce(func, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

// --- Proxy ---
//  Simplified proxy handling (still requires server-side WebSocket proxy for full security)
function getProxiedUrl(url) {
    if (WEB_SOCKET_PROXY_URL) {
        return WEB_SOCKET_PROXY_URL + '?url=' + encodeURIComponent(url);
    } else {
        return window.location.origin + '/?' + encodeURIComponent(url);
    }
}


// --- Find in Page ---
let currentSearchTerm = '';
let searchResults = [];
let currentResultIndex = -1;

function findInPage(searchTerm) {
    if (!activeTabId) return;
    const currentTab = tabs.get(activeTabId);
    if (!currentTab) return;

    // Clear previous results
    searchResults = [];
    currentResultIndex = -1;

    if (!searchTerm) {
        clearFindInPageHighlights(currentTab.iframe); // Clear highlights if search is empty
        return;
    }
    currentSearchTerm = searchTerm;

     try {
        const iframeWindow = currentTab.iframe.contentWindow;
        const iframeDocument = currentTab.iframe.contentDocument;

        function searchNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.toLowerCase();
                let index = text.indexOf(searchTerm.toLowerCase());
                while (index !== -1) {
                    searchResults.push({ node, index });
                    index = text.indexOf(searchTerm.toLowerCase(), index + 1);
                }
            } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName.toLowerCase() !== 'script' && node.nodeName.toLowerCase() !== 'style') {
                for (const child of node.childNodes) {
                    searchNode(child);
                }
            }
        }
         searchNode(iframeDocument.body);
        highlightSearchResults(currentTab.iframe);
        if(searchResults.length > 0){
            scrollToNextResult(); // Scroll to the first result initially
        }


    } catch (e) {
        console.error("Error during find in page:", e);
        // Handle cross-origin iframe access issues
    }
}
//Highlight Results
function highlightSearchResults(iframe) {
      if (!iframe || !iframe.contentDocument) return;
    const iframeDocument = iframe.contentDocument;

    clearFindInPageHighlights(iframe);

    searchResults.forEach(({ node, index }) => {
        const range = iframeDocument.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + currentSearchTerm.length);

        const span = iframeDocument.createElement('span');
        span.className = 'find-in-page-highlight';
        span.style.backgroundColor = 'yellow';
        span.style.color = 'black';
        range.surroundContents(span);
    });

}

function clearFindInPageHighlights(iframe) {
    if (!iframe || !iframe.contentDocument) return;
        const iframeDocument = iframe.contentDocument;

    //Use querySelectorAll for removing highlight
    const highlights = iframeDocument.querySelectorAll('.find-in-page-highlight')
    highlights.forEach(highlight => {
        const parent = highlight.parentNode;
        while(highlight.firstChild){
            parent.insertBefore(highlight.firstChild, highlight);
        }
        parent.removeChild(highlight);
    })
    //Normalize to merge nodes
     iframeDocument.body.normalize();
}

//Scroll to next result
function scrollToNextResult() {
    if (searchResults.length === 0) return;
    const currentTab = tabs.get(activeTabId)
    if(!currentTab) return;
    currentResultIndex = (currentResultIndex + 1) % searchResults.length;
    const { node } = searchResults[currentResultIndex];

     try {
         const iframeWindow = currentTab.iframe.contentWindow;
         if (node && node.parentElement) {
             node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
             //Remove previous highlight and highlight current
             clearFindInPageHighlights(currentTab.iframe)
             highlightSearchResults(currentTab.iframe)
         }

    } catch (e) {
        console.error("Error during find in page:", e);
        // Handle cross-origin iframe access issues
    }
}

//Scroll to previous result
function scrollToPreviousResult() {
    if (searchResults.length === 0) return;
     const currentTab = tabs.get(activeTabId);
    if(!currentTab) return;

    currentResultIndex = (currentResultIndex - 1 + searchResults.length) % searchResults.length; // Wrap around
    const { node } = searchResults[currentResultIndex];

    try {
         const iframeWindow = currentTab.iframe.contentWindow;
        if (node && node.parentElement) {
            node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            //Remove previous highlight and highlight current
            clearFindInPageHighlights(currentTab.iframe);
            highlightSearchResults(currentTab.iframe);
        }
    } catch (e) {
        console.error("Error during find in page:", e);
        // Handle cross-origin iframe access issues
    }
}

// --- Page Loading ---

function loadPage(inputUrl = dom.searchInput.value) {
    if (!inputUrl) return;

    let url = inputUrl;
    if (!activeTabId) {
        newTab(url);
        return;
    }

    if (!url.startsWith('http') && !url.startsWith('https')) {
        url = 'https://' + url;
    }

    const currentTab = tabs.get(activeTabId);
    if (!currentTab) return;

    if (!isValidUrl(url)) {
        const searchEngine = localStorage.getItem('searchEngine') || DEFAULT_SEARCH_ENGINE;
        url = searchEngines[searchEngine] + encodeURIComponent(inputUrl);
    }

    const proxiedUrl = getProxiedUrl(url);

    // Add to history *before* loading
    addToHistory(activeTabId, url);

    try {
        currentTab.iframe.src = proxiedUrl;
    } catch (error) {
        handleIframeError(currentTab.iframe); // Display a robust error message
    }

    deactivateSearchMode();
    dom.searchInput.value = url;
}


// --- Tab Management ---
function newTab(url = "about:blank", restoredHistory = null, restoredHistoryIndex = null, isPinned = false, groupId = null) {
    if (tabs.size >= MAX_TABS) {
        alert("Maximum number of tabs reached!");
        return;
    }

    const tabId = `tab${Date.now()}`;
    const tabButton = createTabButton(tabId, url, isPinned); // Pass isPinned
    const iframeContainer = createIframeContainer(tabId, url);
    const iframe = iframeContainer.querySelector("iframe");

    const newTab = new Tab(tabId, iframe, tabButton, restoredHistory || [], (restoredHistory && restoredHistoryIndex !== null) ? restoredHistoryIndex : -1, isPinned, groupId);
    tabs.set(tabId, newTab);

   //Insert pinned tabs at the beginning, others at the end.
    if (isPinned) {
        dom.tabsContainer.insertBefore(tabButton, dom.tabsContainer.firstChild);
    } else {
        dom.tabsContainer.appendChild(tabButton);
    }

    dom.browsers.appendChild(iframeContainer);

    switchTab(tabId);
    dom.searchInput.value = '';
    deactivateSearchMode();
    updateBookmarksUI();
    return tabId;
}

function createTabButton(tabId, initialUrl, isPinned) {
    const tabButton = document.createElement("div");
    tabButton.className = `tab ${isPinned ? 'pinned' : ''}`; // Add 'pinned' class
    tabButton.textContent = initialUrl === "about:blank" ? "New Tab" : "Loading...";
    tabButton.setAttribute("data-tab", tabId);

    //Pinning Icon
    const pinIcon = document.createElement('span');
    pinIcon.className = 'pin-icon material-icons';
    pinIcon.textContent = 'push_pin'
    pinIcon.style.display = isPinned ? 'inline-block' : 'none'; //Initially hidden
    tabButton.prepend(pinIcon);


    const closeButton = document.createElement("span");
    closeButton.className = "close-tab";
    closeButton.textContent = "×";
    closeButton.onclick = (event) => {
        event.stopPropagation();
        closeTab(tabId);
    };
    if(!isPinned) { //Only show close button if not pinned
        tabButton.appendChild(closeButton);
    }


    tabButton.onclick = () => switchTab(tabId);

      // Context menu for tab (right-click) - simplified for demonstration
    tabButton.oncontextmenu = (event) => {
        event.preventDefault();
        // Basic context menu (could be expanded with more options)
        const menu = document.createElement('div');
        menu.className = 'tab-context-menu';
        //Pin/unpin
        const pinOption = document.createElement('div');
        pinOption.textContent = isPinned ? "Unpin Tab" : "Pin Tab";
        pinOption.onclick = () => {
            toggleTabPin(tabId);
            menu.remove();
        };
        menu.appendChild(pinOption)

        //Close Tab
        const closeOption = document.createElement('div');
        closeOption.textContent = "Close Tab";
        closeOption.onclick = () => {
            closeTab(tabId);
            menu.remove();
        };
        menu.appendChild(closeOption);


        const rect = tabButton.getBoundingClientRect();
        menu.style.top = `${rect.bottom}px`;
        menu.style.left = `${rect.left}px`;
        document.body.appendChild(menu);

        // Close the menu when clicking outside
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => { // Use setTimeout to avoid immediate closing
            document.addEventListener('click', closeMenu);
        }, 0);
    };

    return tabButton;
}

// Pin Tab
function toggleTabPin(tabId) {
    const tab = tabs.get(tabId);
    if (!tab) return;

    tab.isPinned = !tab.isPinned;
    tab.button.classList.toggle('pinned', tab.isPinned);

    // Move the tab button to the correct position (start for pinned, end for unpinned)
    if (tab.isPinned) {
        dom.tabsContainer.insertBefore(tab.button, dom.tabsContainer.firstChild);
        //Remove close button and add pin icon
        const closeBtn = tab.button.querySelector('.close-tab');
        if(closeBtn) closeBtn.remove();

        const pinIcon = tab.button.querySelector('.pin-icon');
        if(pinIcon) pinIcon.style.display = 'inline-block';

    } else {
        dom.tabsContainer.appendChild(tab.button);
        //Add close button and remove pin icon
         const closeButton = document.createElement("span");
        closeButton.className = "close-tab";
        closeButton.textContent = "×";
        closeButton.onclick = (event) => {
            event.stopPropagation();
            closeTab(tabId);
        };
        tab.button.appendChild(closeButton);

        const pinIcon = tab.button.querySelector('.pin-icon');
        if(pinIcon) pinIcon.style.display = 'none';
    }
    //Update UI and switch tab if needed
    if(activeTabId === tabId){
        switchTab(tabId)
    }
}

function createIframeContainer(tabId, url) {
    const iframeContainer = document.createElement("div");
    iframeContainer.className = "iframe-container";
    iframeContainer.id = tabId;

    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-forms allow-scripts allow-same-origin allow-downloads allow-popups allow-modals allow-top-navigation-by-user-activation";
    iframe.src = url;
    iframeContainer.appendChild(iframe);

    iframe.onload = () => handleIframeLoad(iframe, tabId);
    iframe.onerror = () => handleIframeError(iframe);

    return iframeContainer;
}

function handleIframeLoad(iframe, tabId) {
    const tab = tabs.get(tabId);
    if (!tab) return;

    const tabButton = tab.button;
    const closeButton = tabButton.querySelector('.close-tab'); // Get existing

    try {
        const pageTitle = iframe.contentDocument.title;
        const currentUrl = iframe.contentWindow.location.href;

        tabButton.innerHTML = DOMPurify.sanitize(pageTitle || currentUrl); // Sanitize
          // Re-append close and pin
        const pinIcon = tab.button.querySelector('.pin-icon');
        if(pinIcon) tabButton.prepend(pinIcon); //add to the beginning
        if (closeButton && !tab.isPinned) tabButton.appendChild(closeButton);


        if (tabId === activeTabId) {
            dom.searchInput.value = currentUrl;
            updateBookmarkIcon(currentUrl);
        }
        //History handled when loading
    } catch (e) {
        const currentUrl = iframe.src;
        tabButton.textContent =  currentUrl;
        // Re-append close and pin
        const pinIcon = tab.button.querySelector('.pin-icon');
        if(pinIcon) tabButton.prepend(pinIcon); //add to the beginning
        if (closeButton && !tab.isPinned) tabButton.appendChild(closeButton);

        if (tabId === activeTabId) {
            dom.searchInput.value = currentUrl;
            updateBookmarkIcon(currentUrl);
        }
       //History handled when loading
    }
}

function handleIframeError(iframe) {
    iframe.src = "about:blank";
    try {
        iframe.contentDocument.body.innerHTML = `<div style="text-align: center; padding: 20px;">
                                                <h2>Error</h2>
                                                <p>The page could not be loaded.</p>
                                                </div>`;
    } catch (error) {
        console.error("Error setting error page", error);
    }
}

function closeTab(tabId) {
    const tab = tabs.get(tabId);
    if (!tab) return;

    tab.button.remove();
    tab.iframe.parentElement.remove(); // Remove the container
    tabs.delete(tabId);

    if (tabId === activeTabId) {
       const tabIds = Array.from(tabs.keys());
        if (tabIds.length > 0) {
            switchTab(tabIds[tabIds.length - 1]);
        } else {
            activeTabId = null;
            dom.searchInput.value = '';
            dom.back.disabled = true;
            dom.forward.disabled = true;
            dom.bookmarkBtn.innerHTML = '<span class="material-icons">star_border</span>';
        }
    }
    //Update navigation
    if(activeTabId){
        updateNavigationButtons(activeTabId);
    }
}

function switchTab(tabId) {
    tabs.forEach((tab) => {
        tab.button.classList.remove("active");
        tab.iframe.parentElement.classList.remove("active");
    });

    const tab = tabs.get(tabId);
    if (!tab) return;

    tab.button.classList.add("active");
    tab.iframe.parentElement.classList.add("active");
    activeTabId = tabId;

    try {
        dom.searchInput.value = tab.iframe.contentWindow.location.href;
        updateBookmarkIcon(tab.iframe.contentWindow.location.href);
    } catch (error) {
        dom.searchInput.value = tab.iframe.src
        updateBookmarkIcon(tab.iframe.src)
    }
     // Update navigation buttons
    updateNavigationButtons(tabId)
    clearFindInPageHighlights(tab.iframe); //Clear previous highlights
}

// --- Navigation ---

function addToHistory(tabId, url) {
    const tab = tabs.get(tabId);
    if (!tab || !url) return;

    if (tab.historyIndex < tab.history.length - 1) {
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
    }

    // Check if the new URL is the same as the last one
    if(tab.history.length > 0 && tab.history[tab.historyIndex] === url){
        return;
    }

    tab.history.push(url);
    tab.historyIndex++;

    if (tab.history.length > MAX_HISTORY_ENTRIES) {
        tab.history.shift();
        tab.historyIndex--;
    }

    updateNavigationButtons(tabId);
    updateHistoryUI();
}

function goBack() {
    const currentTab = tabs.get(activeTabId);
    if (!currentTab || currentTab.historyIndex <= 0) return;

    currentTab.historyIndex--;
    const url = currentTab.history[currentTab.historyIndex];
    loadHistoryEntry(url);
}

function goForward() {
   const currentTab = tabs.get(activeTabId);
    if (!currentTab || currentTab.historyIndex >= currentTab.history.length - 1) return;

    currentTab.historyIndex++;
    const url = currentTab.history[currentTab.historyIndex];
    loadHistoryEntry(url);
}

function loadHistoryEntry(url) {
    if(!activeTabId) return;
    const currentTab = tabs.get(activeTabId);
    if(!currentTab) return

    const proxiedUrl = getProxiedUrl(url);
    currentTab.iframe.src = proxiedUrl;
    dom.searchInput.value = url;
    updateNavigationButtons(activeTabId);
}

function updateNavigationButtons(tabId) {
   if (activeTabId !== tabId) return;

    const tab = tabs.get(tabId);
    if (!tab) {
        dom.back.disabled = true;
        dom.forward.disabled = true;
        return;
    }

    dom.back.disabled = tab.historyIndex <= 0;
    dom.forward.disabled = tab.historyIndex >= tab.history.length - 1;
}

// --- Bookmarks ---

function toggleBookmark(url) {
    if (!url) return;
    const currentTab = tabs.get(activeTabId);
    if(!currentTab) return;

    let title;
    try{
        title = currentTab.iframe.contentDocument.title;
    } catch (error){
         title = url;
    }


    if (bookmarks.has(url)) {
        bookmarks.delete(url);
        dom.bookmarkBtn.innerHTML = '<span class="material-icons">star_border</span>';
    } else {
        bookmarks.set(url, { title: DOMPurify.sanitize(title), addedDate: new Date() });
        dom.bookmarkBtn.innerHTML = '<span class="material-icons">star</span>';
    }

    localStorage.setItem('bookmarks', JSON.stringify(Array.from(bookmarks.entries())));
    updateBookmarksUI();
}

function updateBookmarkIcon(currentUrl) {
    dom.bookmarkBtn.innerHTML = bookmarks.has(currentUrl) ? '<span class="material-icons">star</span>' : '<span class="material-icons">star_border</span>';
}

function updateBookmarksUI() {
    dom.bookmarksList.innerHTML = '';

    const sortedBookmarks = Array.from(bookmarks.entries()).sort(([, a], [, b]) => b.addedDate - a.addedDate);

    sortedBookmarks.forEach(([url, { title }]) => {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = "#";
        link.textContent = title;
        link.onclick = () => {
            loadPage(url);
            closeBookmarksDropdown();
        };
        li.appendChild(link);
        dom.bookmarksList.appendChild(li);
    });

    if (bookmarks.size === 0) {
        const emptyLi = document.createElement('li');
        emptyLi.textContent = "No bookmarks yet.";
        dom.bookmarksList.appendChild(emptyLi);
    }
}

// --- History Dropdown ---
function clearHistory() {
   tabs.forEach(tab => {
        tab.history = [];
        tab.historyIndex = -1;
    });
    updateHistoryUI();
    closeHistoryDropdown();
    if(activeTabId) {
        updateNavigationButtons(activeTabId)
    }
}

function updateHistoryUI() {
   dom.historyList.innerHTML = "";

    // Create a single, flat history array from all tabs
    let allHistory = [];
    tabs.forEach(tab => {
        allHistory = allHistory.concat(tab.history);
    });

     //Remove duplicates using set
    const uniqueHistory = [...new Set(allHistory)]

    uniqueHistory.forEach(url => {
        const li = document.createElement('li');
        li.textContent = url;
        li.onclick = () => {
            loadPage(url);
            closeHistoryDropdown();
        };
        dom.historyList.appendChild(li);
    });
    //Display no history message if empty
    if(dom.historyList.children.length === 0) {
        const empty = document.createElement('li');
        empty.textContent = "No history yet";
        dom.historyList.appendChild(empty)
    }
}

function openHistoryDropdown() {
    updateHistoryUI();
    dom.historyDropdown.classList.add('active');
}

function closeHistoryDropdown() {
    dom.historyDropdown.classList.remove('active');
}

// --- Settings Menu ---

function loadSettings() {
    const savedEngine = localStorage.getItem('searchEngine') || DEFAULT_SEARCH_ENGINE;
    dom.searchEngineSelect.value = savedEngine;

    const savedTheme = localStorage.getItem('theme');
     document.body.classList.toggle('light-mode', savedTheme === 'light'); // Apply class
    dom.themeToggle.textContent = savedTheme === 'light' ? 'brightness_2' : 'brightness_4';
}

// --- Reload Tab ---

function reloadCurrentTab() {
    if (!activeTabId) return;
    const currentTab = tabs.get(activeTabId);
     try {
            currentTab.iframe.contentWindow.location.reload();
        } catch (e) {
            currentTab.iframe.src = currentTab.iframe.src; //force reload
        }
}

// --- Search Mode Functions ---
function activateSearchMode() {
    dom.controls.classList.add('search-mode');
    dom.suggestionList.style.display = 'block';
}

function deactivateSearchMode() {
    dom.controls.classList.remove('search-mode');
    dom.suggestionList.style.display = 'none';
}

// --- Theme Switching ---
function toggleTheme() {
    const isLightMode = document.body.classList.toggle('light-mode');
    dom.themeToggle.textContent = isLightMode ? 'brightness_2' : 'brightness_4'; // Toggle icon
    localStorage.setItem('theme', isLightMode ? 'light' : 'dark');
}

// --- Event Listeners ---

// Search Input (with debouncing)
const debouncedLoadPage = debounce(loadPage, DEBOUNCE_DELAY);
dom.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        debouncedLoadPage();
    }
});

//Theme Toggle
dom.themeToggle.addEventListener('click', toggleTheme);

// Search Engine Change
dom.searchEngineSelect.addEventListener('change', (e) => {
    localStorage.setItem('searchEngine', e.target.value);
});

// History Button
dom.historyButton.addEventListener('click', (e) => {
    openHistoryDropdown();
    e.stopPropagation();
});

//Clear History
dom.clearHistoryBtn.addEventListener('click', (e) => {
    clearHistory();
    e.stopPropagation();
});

// Settings Button
dom.settingsButton.addEventListener('click', () => {
    dom.settingsMenu.classList.toggle('active');
});

// Close Settings
dom.closeSettings.addEventListener('click', () => {
    dom.settingsMenu.classList.remove('active');
});

//Reload
dom.reloadBtn.addEventListener('click', reloadCurrentTab);
// Back/Forward
dom.back.addEventListener('click', goBack);
dom.forward.addEventListener('click', goForward);

// Bookmarks Button
dom.bookmarkBtn.addEventListener('click', () => {
    if (!activeTabId) return;
    const currentTab = tabs.get(activeTabId);
    if(!currentTab) return;
    let currentUrl;

    try {
         currentUrl = currentTab.iframe.contentWindow.location.href;
    } catch (error) {
        currentUrl = currentTab.iframe.src
    }
    toggleBookmark(currentUrl);
});

// Bookmarks Dropdown
dom.bookmarksButton.addEventListener('click', (e) => {
    updateBookmarksUI();
    dom.bookmarksDropdown.classList.add('active');
    e.stopPropagation();
});

function closeBookmarksDropdown() {
    dom.bookmarksDropdown.classList.remove('active');
}

//Find in Page Input
dom.findInPageInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value;
    findInPage(searchTerm);
})
//Find in Page Previous
dom.findInPagePrev.addEventListener('click', () => {
    scrollToPreviousResult();
});
//Find in Page Next
dom.findInPageNext.addEventListener('click', () => {
    scrollToNextResult();
});
//Find in Page Close
dom.findInPageClose.addEventListener('click', () => {
    dom.findInPageContainer.style.display = 'none'; //Hide
     if(activeTabId){
        const currentTab = tabs.get(activeTabId);
        if(currentTab) {
            clearFindInPageHighlights(currentTab.iframe); //Clear highlights
        }
    }
    //Reset
    currentSearchTerm = '';
    searchResults = [];
    currentResultIndex = -1;
});

// Document Click (Close Menus)
document.addEventListener('click', (e) => {
    if (!dom.historyDropdown.contains(e.target) && !dom.historyButton.contains(e.target)) {
        closeHistoryDropdown();
    }
    if (!dom.settingsMenu.contains(e.target) && !dom.settingsButton.contains(e.target)) {
        dom.settingsMenu.classList.remove('active');
    }
    if (!dom.bookmarksDropdown.contains(e.target) && !dom.bookmarksButton.contains(e.target)) {
        closeBookmarksDropdown();
    }
    if (!dom.controls.contains(e.target)) {
        deactivateSearchMode();
    }
    if (!dom.suggestionList.contains(e.target)) {
        dom.suggestionList.style.display = 'none';
    }

});

// --- Service Worker (Basic Example) ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js') //  Create a sw.js file
        .then(registration => {
            console.log('Service Worker registered with scope:', registration.scope);
        })
        .catch(err => {
            console.error('Service Worker registration failed:', err);
        });
}

// --- Proxy Script ---
const url = window.location.href.split('?').slice(1).join('?');
if (url) {
    const decodedUrl = decodeURIComponent(url);
    window.addEventListener('load', () => {
        if (!document.querySelector('iframe')) {
            newTab(decodedUrl); // Open after page loads
        }
    });
}

// Search Engines
const searchEngines = {
    brave: "https://search.brave.com/search?q=",
    google: "https://www.google.com/search?q=",
    yandex: "https://yandex.com/search/?text=",
    duckduckgo: "https://duckduckgo.com/?q="
};

// --- Initialization ---

function initialize() {
    loadSettings();
    // Load bookmarks (handling potential errors)
    try {
        const storedBookmarks = JSON.parse(localStorage.getItem('bookmarks'));
        if (Array.isArray(storedBookmarks)) {
            storedBookmarks.forEach(([url, data]) => {
              if(typeof data === 'object' && data !== null && typeof data.title === 'string'){ //Check valid object
                    bookmarks.set(url, { title: DOMPurify.sanitize(data.title), addedDate: new Date(data.addedDate || Date.now()) });
                }
            });
        }
    } catch (error) {
        console.error("Error loading bookmarks:", error);
        localStorage.removeItem('bookmarks');
        bookmarks.clear();
    }

    newTab(); // Start with one tab
    updateBookmarksUI();
    updateHistoryUI();
}

initialize();
