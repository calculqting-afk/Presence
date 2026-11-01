import { hometownLabel } from '../core/StudentPersonalInfo.js';
import {
  LOCATION_STEPS,
  HOMETOWN_GROUPS,
  groupedLocationData,
  locationOptions,
  filterLocations,
  selectedHometown
} from '../core/HometownLocationPolicy.js';

const CATALOG_URL = new URL('../../data/hometown/locations.json', import.meta.url);
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const EMPTY_HOMETOWN_LABEL = 'Not provided';

// Share one download between picker instances. Failed requests can be retried.
export class HometownCatalog {
  #pendingRequest = null;
  #fetch;

  constructor(fetcher = globalThis.fetch.bind(globalThis)) {
    this.#fetch = fetcher;
  }

  load() {
    if (!this.#pendingRequest) {
      this.#pendingRequest = this.fetchCatalog().catch(error => {
        this.#pendingRequest = null;
        throw error;
      });
    }
    return this.#pendingRequest;
  }

  async fetchCatalog() {
    const response = await this.#fetch(CATALOG_URL, {
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Location lists could not be loaded.');

    const catalog = await response.json();
    if (!Array.isArray(catalog.regions) || !catalog.regions.length) {
      throw new Error('Location lists are unavailable.');
    }
    return catalog;
  }
}

const sharedCatalog = new HometownCatalog();

export class HometownPickerController {
  constructor(field, catalogSource = sharedCatalog) {
    this.document = field.ownerDocument;
    this.catalogSource = catalogSource;
    this.trigger = field.querySelector('[data-hometown-open]');
    this.inputs = [...field.querySelectorAll('input')];
    this.requestId = 0;

    this.trigger.addEventListener('click', () => this.open());
    this.inputs.forEach(input => {
      input.addEventListener('change', () => this.refreshField());
    });
    field.closest('form')?.addEventListener('reset', () => {
      setTimeout(() => this.refreshField(), 0);
    });
    this.refreshField();
  }

  inputKey(input) {
    return input.name || input.dataset.hometownKey;
  }

  readFields() {
    return Object.fromEntries(
      this.inputs.map(input => [this.inputKey(input), input.value])
    );
  }

  refreshField() {
    const label = hometownLabel(this.readFields());
    const hasHometown = label !== EMPTY_HOMETOWN_LABEL;

    this.trigger.querySelector('[data-hometown-value]').textContent = hasHometown
      ? label
      : 'Select region, city and barangay';
    this.trigger.classList.toggle('has-value', hasHometown);
  }

  buildDialog() {
    this.dialog = this.document.createElement('dialog');
    this.dialog.className = 'hometown-dialog';
    this.dialog.setAttribute('aria-label', 'Select hometown');
    this.dialog.innerHTML = `
      <div class="hometown-sheet">
        <header class="hometown-header">
          <button type="button" class="hometown-back" aria-label="Close hometown picker">←</button>
          <div class="hometown-search-wrap">
            <label for="hometownSearch">Search <span data-search-step>region</span></label>
            <input id="hometownSearch" type="search" placeholder="Search region"
              autocomplete="off" enterkeyhint="search">
          </div>
        </header>
        <div class="hometown-current" hidden></div>
        <section class="hometown-selection" aria-label="Selected location">
          <div class="hometown-selection-heading">
            <span>Selected location</span>
            <button type="button" class="hometown-reset">Reset</button>
          </div>
          <ol class="hometown-trail"></ol>
        </section>
        <div class="hometown-status" role="status" aria-live="polite" id="hometownListLabel"></div>
        <div class="hometown-options" role="region" aria-labelledby="hometownListLabel" tabindex="0"></div>
        <footer class="hometown-footer">
          <span>Region → Province → City → Barangay</span>
          <button type="button" class="hometown-cancel">Cancel</button>
        </footer>
      </div>`;

    this.document.body.append(this.dialog);
    this.searchInput = this.dialog.querySelector('input');
    this.optionList = this.dialog.querySelector('.hometown-options');
    this.status = this.dialog.querySelector('.hometown-status');
    this.selectionTrail = this.dialog.querySelector('.hometown-trail');
    this.backButton = this.dialog.querySelector('.hometown-back');
    this.bindDialogEvents();
  }

  bindDialogEvents() {
    this.searchInput.addEventListener('input', () => this.renderOptions());
    this.backButton.addEventListener('click', () => this.goBack());
    this.dialog.querySelector('.hometown-reset').addEventListener('click', () => this.resetSelection());
    this.dialog.querySelector('.hometown-cancel').addEventListener('click', () => this.close());
    this.dialog.addEventListener('cancel', event => {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
    this.dialog.addEventListener('click', event => this.handleBackdropClick(event));
    // The parent registration/profile dialog must not handle this dialog's keys.
    this.dialog.addEventListener('keydown', event => event.stopPropagation());
  }

  handleBackdropClick(event) {
    if (event.target !== this.dialog) return;

    const bounds = this.dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) this.close();
  }

  prefersReducedMotion() {
    return this.document.defaultView.matchMedia(REDUCED_MOTION_QUERY).matches;
  }

  async open() {
    if (!this.dialog) this.buildDialog();
    if (this.dialog.open) return;

    this.selectedLocations = [];
    this.currentStep = 0;
    this.regionData = null;
    this.regions = [];
    this.isClosing = false;
    this.renderedStep = null;
    this.dialog.classList.remove('is-closing');

    const current = this.dialog.querySelector('.hometown-current');
    const savedHometown = hometownLabel(this.readFields());
    current.textContent = `Saved hometown: ${savedHometown}`;
    current.hidden = savedHometown === EMPTY_HOMETOWN_LABEL;

    this.dialog.showModal();
    this.trigger.setAttribute('aria-expanded', 'true');
    this.previousOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
    await this.loadStep(0);
  }

  close() {
    if (!this.dialog?.open || this.isClosing) return;

    this.isClosing = true;
    this.requestId += 1;
    this.dialog.classList.add('is-closing');
    const animationDuration = this.prefersReducedMotion() ? 0 : 160;

    setTimeout(() => {
      this.dialog.close();
      this.document.body.style.overflow = this.previousOverflow;
      this.trigger.setAttribute('aria-expanded', 'false');
      this.trigger.focus();
      this.isClosing = false;
    }, animationDuration);
  }

  isActiveRequest(requestId) {
    return requestId === this.requestId && this.dialog.open && !this.isClosing;
  }

  async loadStep(step) {
    const requestId = ++this.requestId;
    this.currentStep = step;
    this.searchInput.value = '';
    this.isLoading = true;
    this.hasError = false;
    this.render();

    try {
      if (step === 0) {
        const catalog = await this.catalogSource.load();
        if (!this.isActiveRequest(requestId)) return;
        this.catalog = catalog;
        this.regions = HOMETOWN_GROUPS;
      } else if (step === 1) {
        this.regionData = groupedLocationData(this.catalog, this.selectedLocations[0].code);
        // Metro Manila has no province layer; continue directly to cities.
        if (!this.regionData.provinces.length) {
          this.selectedLocations[1] = { code: 'independent', name: 'No province' };
          this.currentStep = 2;
        }
      }
      if (!this.isActiveRequest(requestId)) return;
      this.isLoading = false;
      this.render();
    } catch {
      if (!this.isActiveRequest(requestId)) return;
      this.isLoading = false;
      this.hasError = true;
      this.render();
    }
  }

  goToStep(step) {
    this.requestId += 1;
    this.currentStep = step;
    this.searchInput.value = '';
    this.isLoading = false;
    this.hasError = false;

    if (step === 1 && !this.regionData) {
      this.loadStep(step);
      return;
    }
    this.render();
    this.optionList.focus({ preventScroll: true });
  }

  goBack() {
    if (this.currentStep === 0) {
      this.close();
      return;
    }
    const skipProvince = this.currentStep === 2 && !this.regionData?.provinces.length;
    this.goToStep(skipProvince ? 0 : this.currentStep - 1);
  }

  resetSelection() {
    this.selectedLocations = [];
    this.regionData = null;
    this.loadStep(0);
  }

  render() {
    this.renderSelectionTrail();
    this.backButton.disabled = this.isLoading && this.currentStep > 0;
    this.backButton.setAttribute('aria-label', this.currentStep === 0
      ? 'Close hometown picker'
      : 'Back to previous location step');

    const stepName = LOCATION_STEPS[this.currentStep].toLowerCase();
    this.searchInput.placeholder = `Search ${stepName}`;
    this.searchInput.disabled = this.isLoading || this.hasError;
    this.dialog.querySelector('[data-search-step]').textContent = stepName;
    this.renderOptions();
    this.animateStepChange();
  }

  renderSelectionTrail() {
    this.selectionTrail.replaceChildren();
    LOCATION_STEPS.forEach((label, step) => {
      const skippedProvince = step === 1 && this.regionData && !this.regionData.provinces.length;
      if (step > this.currentStep || skippedProvince) return;

      const isCurrent = step === this.currentStep;
      const selectedName = this.selectedLocations[step]?.name || label;
      const row = this.document.createElement('li');
      row.className = isCurrent ? 'is-current' : 'is-complete';

      const button = this.document.createElement('button');
      button.type = 'button';
      button.dataset.step = String(step);
      button.textContent = isCurrent ? `Select ${label}` : selectedName;
      button.setAttribute('aria-label', `${label}: ${isCurrent ? 'Choose' : selectedName}`);
      if (isCurrent) button.setAttribute('aria-current', 'step');
      button.disabled = this.isLoading;
      button.addEventListener('click', () => this.goToStep(step));

      row.append(button);
      this.selectionTrail.append(row);
    });
  }

  animateStepChange() {
    if (this.isLoading || this.renderedStep === this.currentStep) return;

    if (!this.prefersReducedMotion()) {
      this.optionList.animate?.([
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'none' }
      ], { duration: 180, easing: 'ease-out' });
    }
    this.renderedStep = this.currentStep;
  }

  renderOptions() {
    this.optionList.replaceChildren();
    this.status.replaceChildren();
    this.optionList.setAttribute('aria-busy', String(this.isLoading));
    this.status.classList.toggle('is-loading', this.isLoading);

    if (this.isLoading) {
      this.status.textContent = 'Loading location lists…';
      return;
    }
    if (this.hasError) {
      this.renderRetry();
      return;
    }

    const options = locationOptions(this.currentStep, this.regions, this.regionData, this.selectedLocations);
    const matches = filterLocations(options, this.searchInput.value);
    this.status.textContent = matches.length
      ? `${LOCATION_STEPS[this.currentStep]} · ${matches.length} ${matches.length === 1 ? 'option' : 'options'}`
      : 'No matching locations. Try a different search.';

    let previousLetter = '';
    for (const location of matches) {
      const firstLetter = location.name.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').slice(0, 1).toLocaleUpperCase();
      const headingLetter = firstLetter === previousLetter ? '' : firstLetter;
      this.optionList.append(this.createOption(location, headingLetter));
      previousLetter = firstLetter;
    }
    this.optionList.scrollTop = 0;
  }

  renderRetry() {
    this.status.textContent = 'Couldn’t load the location list. Please try again.';
    const retryButton = this.document.createElement('button');
    retryButton.type = 'button';
    retryButton.textContent = 'Retry';
    retryButton.addEventListener('click', () => this.loadStep(this.currentStep));
    this.status.append(retryButton);
  }

  createOption(location, headingLetter) {
    const isSelected = this.selectedLocations[this.currentStep]?.code === location.code;
    const button = this.document.createElement('button');
    button.type = 'button';
    button.className = 'hometown-option';
    button.classList.toggle('is-selected', isSelected);

    const letter = this.document.createElement('span');
    letter.className = 'hometown-letter';
    letter.textContent = headingLetter;
    letter.setAttribute('aria-hidden', 'true');

    const label = this.document.createElement('span');
    label.textContent = location.name;

    const mark = this.document.createElement('span');
    mark.textContent = isSelected ? '✓' : '›';
    mark.setAttribute('aria-hidden', 'true');

    button.append(letter, label, mark);
    button.addEventListener('click', () => this.chooseLocation(location));
    return button;
  }

  async chooseLocation(location) {
    const step = this.currentStep;
    this.selectedLocations = this.selectedLocations.slice(0, step);
    this.selectedLocations[step] = location;

    if (step < 3) {
      await this.loadStep(step + 1);
      // Do not force the search keyboard open when advancing on a phone.
      if (this.dialog.open && !this.isClosing && !this.hasError) {
        this.optionList.focus({ preventScroll: true });
      }
      return;
    }
    this.applySelection();
  }

  applySelection() {
    const hometown = selectedHometown(this.selectedLocations);
    for (const input of this.inputs) {
      input.value = hometown[this.inputKey(input)] || '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.refreshField();
    this.close();
  }
}

// Each page has one hometown field; its controller owns that field and its dialog.
globalThis.document?.querySelectorAll('[data-hometown-picker]').forEach(field => {
  new HometownPickerController(field);
});
