import { AccessibilityLinks } from "./accessibility-links";
import { useInstance } from "../session";
import c from "./accessibility.module.css";

export function AccessibilityPage() {
  const instance = useInstance();
  return <main className={c.page}>
    <h1>Accessibility statement</h1>
    <p>{instance.name} targets WCAG 2.1 Level AA. This is a target, not a certification or a claim of full conformance.</p>
    <h2>Testing and evidence</h2>
    <p>The repository includes automated axe checks in frontend tests and browser tests. Automated checks identify only some accessibility barriers. A passing check is not a screen-reader audit.</p>
    <p>This statement does not assert that this installation, its institution content, or every supported browser and assistive technology combination has been manually audited. Ask the operator for current installation-specific testing evidence.</p>
    <p>Feature verification on 31 October 2026 included automated axe and keyboard dialog checks, plus 390-pixel Chromium checks with mocked API data. This is not a live installation or screen-reader audit.</p>
    <h2>Known limitations</h2>
    <p>Generated answers and uploaded source documents may have accessibility problems. Source formatting and model-generated content are not guaranteed accessible. Streaming, embedded widgets, keyboard navigation and screen-reader use need continued manual testing. No screen-reader audit has been performed for this feature.</p>
    <h2>Report an accessibility problem</h2>
    <p>Include the page address, what you were trying to do, and your browser and assistive technology if you are comfortable sharing them. Do not include private conversations or sensitive information.</p>
    <AccessibilityLinks />
  </main>;
}
