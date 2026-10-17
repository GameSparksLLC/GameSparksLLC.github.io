document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = String(new Date().getFullYear());
});

const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#site-nav");
const siteHeader = document.querySelector(".site-header");

// Move the shared mobile highlight behind the current navigation link.
const updateActiveNavIndicator = () => {
  if (!navigation) return;

  const activeLink = navigation.querySelector('a[aria-current="page"], a[aria-current="location"]');
  if (!activeLink) {
    navigation.style.setProperty("--active-nav-opacity", "0");
    return;
  }

  const navigationBounds = navigation.getBoundingClientRect();
  const activeBounds = activeLink.getBoundingClientRect();
  navigation.style.setProperty("--active-nav-y", `${activeBounds.top - navigationBounds.top}px`);
  navigation.style.setProperty("--active-nav-height", `${activeBounds.height}px`);
  navigation.style.setProperty("--active-nav-opacity", "1");
};

if (siteHeader) {
  const updateHeaderOnScroll = () => {
    siteHeader.classList.toggle("is-scrolled", window.scrollY > 8);
  };

  updateHeaderOnScroll();
  window.addEventListener("scroll", updateHeaderOnScroll, { passive: true });
}

if (navigation) {
  const sectionLinks = [...navigation.querySelectorAll('a[href^="#"]')]
    .map((link) => ({ link, section: document.querySelector(link.getAttribute("href")) }))
    .filter(({ section }) => section);

  if (sectionLinks.length && "IntersectionObserver" in window) {
    const updateCurrentSection = () => {
      const marker = window.innerHeight * 0.36;
      let active = null;
      sectionLinks.forEach((entry) => {
        if (entry.section.getBoundingClientRect().top <= marker) active = entry;
      });

      sectionLinks.forEach(({ link, section }) => {
        if (active?.section === section) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });

      updateActiveNavIndicator();
    };

    const sectionObserver = new IntersectionObserver(updateCurrentSection, { threshold: 0 });

    sectionLinks.forEach(({ section }) => sectionObserver.observe(section));
    updateCurrentSection();
    window.addEventListener("scroll", updateCurrentSection, { passive: true });
    window.addEventListener("resize", updateCurrentSection);
  } else {
    updateActiveNavIndicator();
  }
}

if (menuButton && navigation) {
  const closeMenu = () => {
    menuButton.setAttribute("aria-expanded", "false");
    navigation.classList.remove("is-open");
  };

  menuButton.addEventListener("click", () => {
    const isOpen = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!isOpen));
    navigation.classList.toggle("is-open", !isOpen);
    updateActiveNavIndicator();
  });

  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      closeMenu();
      menuButton.focus();
    }
  });
}

updateActiveNavIndicator();

const heroArtwork = document.querySelector(".hero-art-canvas");
const heroArtworkContainer = document.querySelector(".hero-art");

if (heroArtwork && heroArtworkContainer) {
  let artworkStarted = false;

  const loadHeroArtwork = () => {
    if (artworkStarted) return;
    artworkStarted = true;
    import("./assets/js/hero-scene.js")
      .then(({ mountHeroScene }) => mountHeroScene(heroArtwork, heroArtworkContainer))
      .catch((error) => {
        console.error("Unable to load the interactive Luna showcase.", error);
        const artworkStatus = heroArtworkContainer.querySelector(".hero-art-status");
        const wireframeToggle = heroArtworkContainer.querySelector(".wireframe-toggle");
        if (artworkStatus) {
          artworkStatus.classList.remove("is-loading");
          artworkStatus.classList.add("is-error");
          const statusDescription = artworkStatus.querySelector(".hero-visually-hidden");
          if (statusDescription) statusDescription.textContent = "Luna's 3D preview couldn't load.";
        }
        if (wireframeToggle) wireframeToggle.disabled = true;
        heroArtworkContainer.classList.add("hero-art-fallback");
      });
  };

  if ("IntersectionObserver" in window) {
    const artworkObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        artworkObserver.disconnect();
        if ("requestIdleCallback" in window) window.requestIdleCallback(loadHeroArtwork, { timeout: 1800 });
        else window.setTimeout(loadHeroArtwork, 350);
      }
    }, { rootMargin: "120px" });
    artworkObserver.observe(heroArtworkContainer);
  } else {
    window.setTimeout(loadHeroArtwork, 350);
  }
}

// Rotate the hero verb and resize its red backing to each measured word width.
const setupHeroWordCycle = async () => {
  const rotator = document.querySelector(".hero-rotator");
  let activeWord = rotator?.querySelector(".hero-rotating-word.is-active");
  let waitingWord = rotator?.querySelector(".hero-rotating-word.is-waiting");
  const words = ["PLAY", "LOVE", "REMEMBER", "ENJOY", "ADORE"];

  if (!rotator || !activeWord || !waitingWord) return;

  const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  await document.fonts.ready;

  const measurer = document.createElement("span");
  measurer.className = "hero-live-measure";
  rotator.append(measurer);

  let activeIndex = 0;
  const wordWidths = new Map();

  // Measure all verbs using the active responsive headline font and spacing.
  const measureHeroWords = () => {
    words.forEach((word) => {
      measurer.textContent = word;
      wordWidths.set(word, measurer.getBoundingClientRect().width);
    });
  };

  // Set the word slot to the active word's measured width at the current viewport size.
  const updateHeroWordLayout = () => {
    measureHeroWords();
    rotator.style.setProperty("--hero-word-width", `${wordWidths.get(words[activeIndex])}px`);
  };

  updateHeroWordLayout();
  window.addEventListener("resize", updateHeroWordLayout);

  if (prefersReducedMotion) return;

  // Prepare the next word and run its flip after the highlight starts resizing.
  const rotateWord = () => {
    if (document.hidden) return;

    const nextIndex = (activeIndex + 1) % words.length;
    waitingWord.textContent = words[nextIndex];
    waitingWord.classList.remove("is-leaving");
    waitingWord.classList.add("is-waiting");
    rotator.style.setProperty("--hero-word-width", `${wordWidths.get(words[nextIndex])}px`);
    void waitingWord.offsetWidth;

    // Flip the outgoing and incoming words together while the highlight resizes.
    requestAnimationFrame(() => {
      activeWord.classList.add("is-leaving");
      waitingWord.classList.remove("is-waiting");

      // Swap the word layers after their transition so the fixed title width remains stable.
      window.setTimeout(() => {
        activeWord.classList.remove("is-leaving");
        activeWord.classList.add("is-waiting");
        [activeWord, waitingWord] = [waitingWord, activeWord];
        activeIndex = nextIndex;
      }, 440);
    });
  };

  window.setInterval(rotateWord, 2800);
};

setupHeroWordCycle();

// Tilt the jumping characters and move the artwork light with a desktop pointer.
const gameFeature = document.querySelector(".game-feature");
const gameArtwork = gameFeature?.querySelector(".game-art");
const gameCharacters = gameFeature?.querySelector(".game-characters");
const gameTiltEnabled = matchMedia("(min-width: 761px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");

if (gameFeature && gameArtwork && gameCharacters && gameTiltEnabled.matches) {
  let pointerX = 0;
  let pointerY = 0;
  let tiltFrame = 0;

  const updateGameTilt = () => {
    tiltFrame = 0;
    const artBounds = gameArtwork.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (pointerX - artBounds.left) / artBounds.width));
    const y = Math.max(0, Math.min(1, (pointerY - artBounds.top) / artBounds.height));
    const lightX = Math.max(0, Math.min(100, ((pointerX - artBounds.left) / artBounds.width) * 100));
    const lightY = Math.max(0, Math.min(100, ((pointerY - artBounds.top) / artBounds.height) * 100));
    const characterBounds = gameCharacters.getBoundingClientRect();
    const shineX = Math.max(0, Math.min(100, ((pointerX - characterBounds.left) / characterBounds.width) * 100));
    const shineY = Math.max(0, Math.min(100, ((pointerY - characterBounds.top) / characterBounds.height) * 100));

    gameFeature.style.setProperty("--game-tilt-x", `${(0.5 - y) * 10}deg`);
    gameFeature.style.setProperty("--game-tilt-y", `${(x - 0.5) * 14}deg`);
    gameArtwork.style.setProperty("--game-light-x", `${lightX}%`);
    gameArtwork.style.setProperty("--game-light-y", `${lightY}%`);
    gameFeature.style.setProperty("--game-shine-x", `${shineX}%`);
    gameFeature.style.setProperty("--game-shine-y", `${shineY}%`);
    gameFeature.style.setProperty("--game-rim-x", `${(x - 0.5) * 3}px`);
    gameFeature.style.setProperty("--game-rim-y", `${(y - 0.5) * 3}px`);
    gameFeature.style.setProperty("--game-shadow-x", `${(0.5 - x) * 8}px`);
    gameFeature.style.setProperty("--game-shadow-y", `${5 + y * 4}px`);
    gameFeature.style.setProperty("--game-rim-angle", `${125 + (x - 0.5) * 90}deg`);
  };

  gameFeature.addEventListener("pointermove", (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!tiltFrame) tiltFrame = requestAnimationFrame(updateGameTilt);
  }, { passive: true });

  gameFeature.addEventListener("pointerleave", () => {
    if (tiltFrame) cancelAnimationFrame(tiltFrame);
    tiltFrame = 0;
    gameFeature.style.setProperty("--game-tilt-x", "0deg");
    gameFeature.style.setProperty("--game-tilt-y", "0deg");
    gameFeature.style.setProperty("--game-shadow-x", "0px");
    gameFeature.style.setProperty("--game-shadow-y", "7px");
    gameFeature.style.setProperty("--game-shine-x", "56%");
    gameFeature.style.setProperty("--game-shine-y", "32%");
    gameFeature.style.setProperty("--game-rim-x", "0px");
    gameFeature.style.setProperty("--game-rim-y", "-2px");
    gameArtwork.style.setProperty("--game-light-x", "54%");
    gameArtwork.style.setProperty("--game-light-y", "36%");
    gameFeature.style.setProperty("--game-rim-angle", "125deg");
  });
}

// Animate the mobile character artwork only while its game card is on screen.
const gameAmbientTiltEnabled = matchMedia("(max-width: 760px) and (prefers-reduced-motion: no-preference)");

if (gameFeature && gameCharacters && gameAmbientTiltEnabled.matches && "IntersectionObserver" in window) {
  gameFeature.style.removeProperty("--game-tilt-x");
  gameFeature.style.removeProperty("--game-tilt-y");

  const gameTiltObserver = new IntersectionObserver(([entry]) => {
    gameFeature.classList.toggle("is-mobile-tilting", entry.isIntersecting);
  }, { threshold: 0.15 });

  gameTiltObserver.observe(gameFeature);
}
