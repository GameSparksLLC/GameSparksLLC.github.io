// Keep all private mail credentials on the server; local form tests use Cloudflare's public dummy key.
const contactTestMode = ["localhost", "127.0.0.1"].includes(location.hostname)
  && new URLSearchParams(location.search).get("contactTest") === "1";
const CONTACT_CONFIG = contactTestMode
  ? { endpoint: "/__dev/contact", turnstileSiteKey: "1x00000000000000000000AA" }
  : (window.GAMESPARKS_CONTACT_CONFIG || { endpoint: "", turnstileSiteKey: "" });

const contactForm = document.querySelector("#contact-form");
const contactStatus = document.querySelector("#contact-status");
const contactSubmit = contactForm?.querySelector("button[type='submit']");
const captchaSlot = document.querySelector("#contact-captcha");
const topicField = document.querySelector("#topic-field");
const topicValue = topicField?.querySelector("input[name='topic']");
const topicTrigger = document.querySelector("#topic-trigger");
const topicDisplay = document.querySelector("#topic-value");
const topicList = document.querySelector("#topic-options");
const topicOptions = [...(topicList?.querySelectorAll("[role='option']") || [])];
let captchaToken = "";
let captchaWidgetId = null;
let typeahead = "";
let typeaheadTimer;

// Display form and service feedback without discarding the visitor's message.
const setContactMessage = (message, state = "") => {
  if (!contactStatus) return;
  contactStatus.textContent = message;
  contactStatus.dataset.state = state;
};

// Enable sending only when the endpoint and a current human-check token exist.
const refreshContactButton = () => {
  if (contactSubmit) contactSubmit.disabled = !CONTACT_CONFIG.endpoint || !captchaToken;
};

// Keep field errors next to their control and expose invalid state to assistive technology.
const setFieldError = (control, error, message = "") => {
  if (!control || !error) return;
  error.textContent = message;
  error.hidden = !message;
  if (message) control.setAttribute("aria-invalid", "true");
  else control.removeAttribute("aria-invalid");
};

// Open the topic list and move keyboard focus to its selected option.
const openTopicList = (focusLast = false) => {
  if (!topicList || !topicTrigger) return;
  topicList.hidden = false;
  topicTrigger.setAttribute("aria-expanded", "true");
  const selectedIndex = topicOptions.findIndex((option) => option.getAttribute("aria-selected") === "true");
  topicOptions[focusLast ? topicOptions.length - 1 : Math.max(0, selectedIndex)]?.focus();
};

// Close the topic list and return focus when keyboard dismissal is requested.
const closeTopicList = (restoreFocus = false) => {
  if (!topicList || !topicTrigger) return;
  topicList.hidden = true;
  topicTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) topicTrigger.focus();
};

// Save the selected topic and announce it through the combobox label.
const chooseTopic = (option) => {
  if (!option || !topicValue || !topicDisplay || !topicTrigger) return;
  topicValue.value = option.dataset.value || "";
  topicDisplay.textContent = option.textContent.trim();
  topicOptions.forEach((item) => item.setAttribute("aria-selected", String(item === option)));
  setFieldError(topicTrigger, document.querySelector("#topic-error"));
  closeTopicList(true);
};

topicTrigger?.addEventListener("click", () => {
  if (topicList?.hidden) openTopicList();
  else closeTopicList();
});

topicTrigger?.addEventListener("keydown", (event) => {
  if (["ArrowDown", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    openTopicList();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    openTopicList(true);
  }
});

topicOptions.forEach((option, index) => {
  option.addEventListener("click", () => chooseTopic(option));
  option.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeTopicList(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      topicOptions[(index + direction + topicOptions.length) % topicOptions.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      topicOptions[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      topicOptions.at(-1)?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseTopic(option);
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      typeahead += event.key.toLocaleLowerCase();
      window.clearTimeout(typeaheadTimer);
      typeaheadTimer = window.setTimeout(() => { typeahead = ""; }, 600);
      const match = topicOptions.find((item) => item.textContent.trim().toLocaleLowerCase().startsWith(typeahead));
      match?.focus();
    }
  });
});

document.addEventListener("pointerdown", (event) => {
  if (topicField && !topicField.contains(event.target)) closeTopicList();
});

// Validate text, email, topic, and message before sending any form data.
const validateContactForm = () => {
  const name = contactForm.elements.name;
  const email = contactForm.elements.email;
  const message = contactForm.elements.message;
  const topicError = document.querySelector("#topic-error");
  const errors = [
    [name, document.querySelector("#name-error"), name.value.trim() ? "" : "Enter your name."],
    [email, document.querySelector("#email-error"), !email.value.trim()
      ? "Enter your email address."
      : (!email.validity.valid ? "Enter a valid email address, like name@example.com." : "")],
    [topicTrigger, topicError, topicValue?.value ? "" : "Choose a topic."],
    [message, document.querySelector("#message-error"), message.value.trim().length < 8
      ? "Add a little more detail (at least 8 characters)."
      : ""],
  ];

  let firstInvalid = null;
  errors.forEach(([control, error, text]) => {
    setFieldError(control, error, text);
    if (text && !firstInvalid) firstInvalid = control;
  });

  if (firstInvalid) {
    firstInvalid.focus();
    setContactMessage("A few details need attention before you send this.", "error");
    return false;
  }
  return true;
};

contactForm?.querySelectorAll("input[name='name'], input[name='email'], textarea[name='message']").forEach((control) => {
  control.addEventListener("input", () => {
    const error = document.querySelector(`#${control.name}-error`);
    setFieldError(control, error);
  });
});

// Record the form start time so the server can reject instant automated submissions.
if (contactForm) contactForm.elements.formStartedAt.value = String(Date.now());

if (!CONTACT_CONFIG.endpoint || !CONTACT_CONFIG.turnstileSiteKey) {
  if (captchaSlot) captchaSlot.textContent = "Secure message form is being set up. You can email us at gamesparksllc@gmail.com for now.";
  setContactMessage("The form is not connected yet. Please use the email link while setup is completed.");
} else {
  // Render Turnstile after its script is ready, using the local-only test key for preview checks.
  const renderContactCaptcha = () => {
    if (!window.turnstile || captchaWidgetId !== null || !captchaSlot) return;
    captchaWidgetId = window.turnstile.render(captchaSlot, {
      sitekey: CONTACT_CONFIG.turnstileSiteKey,
      theme: "light",
      callback: (token) => {
        captchaToken = token;
        if (contactTestMode) setContactMessage("Test check passed. Submissions are simulated; no email will be sent.");
        refreshContactButton();
      },
      "expired-callback": () => {
        captchaToken = "";
        setContactMessage("The human check expired. Please complete it again.", "error");
        refreshContactButton();
      },
      "error-callback": () => {
        captchaToken = "";
        setContactMessage("Spam protection did not load. Please refresh or email us directly.", "error");
        refreshContactButton();
      },
    });
  };

  const captchaLoader = window.setInterval(() => {
    if (!window.turnstile) return;
    window.clearInterval(captchaLoader);
    renderContactCaptcha();
  }, 100);

  window.setTimeout(() => {
    window.clearInterval(captchaLoader);
    if (captchaWidgetId === null) setContactMessage("Spam protection could not load. Please email us directly.", "error");
  }, 8000);
}

// Submit validated data to Formspree while keeping local simulations separate from real delivery.
contactForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validateContactForm()) return;
  if (!CONTACT_CONFIG.endpoint || !captchaToken) {
    setContactMessage("The form is not connected yet. Please use the email link while setup is completed.", "error");
    return;
  }

  contactSubmit.disabled = true;
  setContactMessage(contactTestMode ? "Checking the test submission…" : "Sending your message…");

  try {
    const request = contactTestMode
      ? {
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ...Object.fromEntries(new FormData(contactForm).entries()), turnstileToken: captchaToken }),
        }
      : (() => {
          const body = new FormData(contactForm);
          body.set("cf-turnstile-response", captchaToken);
          return { headers: { Accept: "application/json" }, body };
        })();
    const response = await fetch(CONTACT_CONFIG.endpoint, {
      method: "POST",
      ...request,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || result.errors?.[0]?.message || "Message delivery failed.");

    contactForm.reset();
    contactForm.elements.formStartedAt.value = String(Date.now());
    topicValue.value = "";
    topicDisplay.textContent = "Choose a topic";
    topicOptions.forEach((option) => option.setAttribute("aria-selected", "false"));
    captchaToken = "";
    if (window.turnstile && captchaWidgetId !== null) window.turnstile.reset(captchaWidgetId);
    setContactMessage(result.test ? "Test passed. No email was sent." : "Thanks for reaching out. Your submission was received.", "success");
  } catch (error) {
    setContactMessage(`${error.message} Please review the form or email gamesparksllc@gmail.com.`, "error");
    if (window.turnstile && captchaWidgetId !== null) window.turnstile.reset(captchaWidgetId);
    captchaToken = "";
  } finally {
    refreshContactButton();
  }
});

refreshContactButton();
