import { findAnime, normalize } from "./catalog.js";
export function suggestAnime(catalog, query, { limit = 5, filters = {} } = {}) {
  if (!normalize(query)) return [];
  const count = Number.isFinite(limit) ? Math.max(1, Math.min(8, Math.floor(limit))) : 5;
  return findAnime(catalog, query, filters).slice(0, count);
}
export function bindSearchSuggestions({ form, input, catalog, onSelect }) {
  const events = new AbortController();
  const list = document.createElement("div");
  const status = document.createElement("span");
  const listId = `${form.id}-suggestions`;
  let matches = [];
  let active = -1;
  let dismissed = false;
  list.id = listId;
  list.className = "search-suggestions";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Suggested anime");
  list.hidden = true;
  status.className = "sr-only";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  form.append(list, status);
  form.classList.add("suggestion-host");
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");
  function close() {
    list.hidden = true;
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function select(index) {
    const anime = matches[index];
    if (!anime) return;
    input.value = anime.title;
    close();
    onSelect(anime);
  }
  function highlight(index) {
    active = index;
    for (const [i, option2] of [...list.children].entries()) {
      option2.setAttribute("aria-selected", String(i === active));
    }
    const option = list.children[active];
    if (option) {
      input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }
  function refresh() {
    dismissed = false;
    active = -1;
    input.removeAttribute("aria-activedescendant");
    matches = suggestAnime(catalog, input.value);
    list.replaceChildren();
    if (!normalize(input.value)) {
      status.textContent = "";
      close();
      return;
    }
    for (const [index, anime] of matches.entries()) {
      const option = document.createElement("button");
      const image = document.createElement("img");
      const details = document.createElement("span");
      const title = document.createElement("strong");
      const subtitle = document.createElement("small");
      option.type = "button";
      option.id = `${listId}-${anime.id}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.tabIndex = -1;
      image.src = `./assets/${anime.image}`;
      image.alt = "";
      title.textContent = anime.title;
      subtitle.textContent = `${anime.year} · ${anime.genre}`;
      details.append(title, subtitle);
      option.append(image, details);
      option.addEventListener("click", () => select(index));
      list.append(option);
    }
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "suggestions-empty";
      empty.textContent = "No matching anime in this catalog.";
      list.append(empty);
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    status.textContent = matches.length ? `${matches.length} anime suggestions available.` : "No matching anime.";
  }
  // Keep input focus while the arrow keys select a suggestion.
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (list.hidden || dismissed) refresh();
      if (!matches.length) return;
      const next = active < 0 ? event.key === "ArrowDown" ? 0 : matches.length - 1 : (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      highlight(next);
    } else if (event.key === "Enter" && !list.hidden && active >= 0) {
      event.preventDefault();
      select(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      dismissed = true;
      close();
    }
  }, { signal: events.signal });
  input.addEventListener("input", (event) => {
    if (!event.isComposing) refresh();
  }, { signal: events.signal });
  input.addEventListener("compositionend", refresh, { signal: events.signal });
  input.addEventListener("focus", refresh, { signal: events.signal });
  form.addEventListener("submit", close, { signal: events.signal });
  form.addEventListener("focusout", (event) => {
    if (!form.contains(event.relatedTarget)) close();
  }, { signal: events.signal });
  document.addEventListener("pointerdown", (event) => {
    if (!form.contains(event.target)) close();
  }, { signal: events.signal });
  return { refresh, close, destroy() {
    events.abort();
    list.remove();
    status.remove();
  } };
}
