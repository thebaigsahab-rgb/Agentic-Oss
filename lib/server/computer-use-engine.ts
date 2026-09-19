import "server-only";

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { safeFetchText } from "@/lib/server/safe-fetch";
import { cleanHtmlToText } from "@/lib/server/web-analysis";
import {
  isBlockedCommand,
  openUrlInDefaultBrowser,
  realMouseClick,
  realMouseScroll,
  realTypeText,
  realPressHotkey,
  respectHumanPace,
  takeScreenScreenshot,
  SystemBridgeError,
  isWindows,
} from "@/lib/server/system-bridge";
import type {
  ActionExecutionResult,
  AgentInputMode,
  ComputerActionStep,
  MotorPlan,
  MotorWaypoint,
  ScreenElement,
  ScreenState,
  ScreenElementBoundingBox,
} from "@/lib/computer-use-types";

const execAsync = promisify(exec);

export type ExecuteActionOptions = {
  cursorFrom?: { x: number; y: number };
  humanLike?: boolean;
  // Motor arbitration: agent_owned = virtual only; auto_idle = real devices
  // while the user is idle; takeover = real devices now.
  inputMode?: AgentInputMode;
  idleThresholdSeconds?: number;
};

// Attempts the physical version of an action on the real device. The bridge's
// gate refuses real input unless the mode allows it (idle check or takeover),
// so any SystemBridgeError here simply downgrades to the virtual plane.
async function attemptRealInput(
  mode: AgentInputMode | undefined,
  run: () => Promise<string>,
): Promise<{ real: boolean; note?: string }> {
  if (!mode || mode === "agent_owned") return { real: false };
  try {
    const note = await run();
    return { real: true, note };
  } catch (err) {
    if (err instanceof SystemBridgeError) {
      return { real: false, note: err.message };
    }
    return { real: false, note: err instanceof Error ? `Real input failed: ${err.message}` : "Real input failed." };
  }
}

// ---------------------------------------------------------------------------
// Human motor model — the agent owns its own virtual mouse and keyboard.
// Motion plans use eased waypoints with micro-jitter so playback reads as a
// human hand, not a laser teleport.
// ---------------------------------------------------------------------------

function jitter(scale = 6): number {
  return (Math.random() - 0.5) * 2 * scale;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function buildCursorPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  totalMs: number,
): MotorWaypoint[] {
  const waypoints: MotorWaypoint[] = [];
  const steps = 7 + Math.floor(Math.random() * 4);
  // Distance-based duration, clamped to a believable human flick (180–650ms).
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const duration = Math.max(160, Math.min(650, 140 + distance * 0.9));
  const scale = totalMs > 0 ? Math.min(1, duration / Math.max(1, totalMs)) : 1;

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const eased = easeOutCubic(t);
    waypoints.push({
      x: Math.max(0, Math.min(1000, from.x + (to.x - from.x) * eased + jitter(4 * (1 - t)))),
      y: Math.max(0, Math.min(1000, from.y + (to.y - from.y) * eased + jitter(4 * (1 - t)))),
      t: Math.round(duration * scale * t),
    });
  }
  return waypoints;
}

export function buildKeystrokePlan(text: string): Array<{ char: string; delayMs: number }> {
  const keystrokes: Array<{ char: string; delayMs: number }> = [];
  for (const char of text) {
    let delay = 42 + Math.random() * 74;
    if (".,!?;:".includes(char)) delay += 90 + Math.random() * 110;
    else if (char === " ") delay -= 12;
    else if (char === "\n") delay += 140;
    keystrokes.push({ char, delayMs: Math.round(Math.max(24, delay)) });
  }
  return keystrokes;
}

function buildMotorPlan(
  action: ComputerActionStep,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options?: { typingText?: string; typingSurface?: string; clickRipple?: boolean },
): MotorPlan {
  const preDelayMs = 60 + Math.round(Math.random() * 140);
  const postDelayMs = action.action === "mouse_click" ? 110 + Math.round(Math.random() * 130) : 40 + Math.round(Math.random() * 80);
  return {
    cursorPath: buildCursorPath(from, to, 0),
    keystrokes: options?.typingText ? buildKeystrokePlan(options.typingText) : undefined,
    preDelayMs,
    postDelayMs,
    clickRipple: options?.clickRipple,
    typingSurface: options?.typingSurface,
  };
}

// ---------------------------------------------------------------------------
// Perception — parse fetched HTML into a grounded ScreenState.
// ---------------------------------------------------------------------------

export function parsePageToScreenState(
  html: string,
  url: string,
  explicitTitle?: string,
): ScreenState {
  const { title: extractedTitle, description, text: cleanedText } = cleanHtmlToText(html);
  const title = explicitTitle || extractedTitle || "Active Screen";

  const elements: ScreenElement[] = [];
  const headings: string[] = [];
  let elemIndex = 1;

  // Page section headings double as perception anchors for planning.
  const headingRegex = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let headingMatch;
  while ((headingMatch = headingRegex.exec(html)) !== null && headings.length < 14) {
    const headingText = headingMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (headingText.length >= 3) headings.push(headingText.slice(0, 90));
  }

  // Extract Links
  const linkRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let linkMatch;
  let currentY = 120;

  while ((linkMatch = linkRegex.exec(html)) !== null && elements.length < 40) {
    const attrs = linkMatch[1];
    const innerText = linkMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!innerText || innerText.length < 2) continue;

    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
    const href = hrefMatch ? hrefMatch[1] : undefined;

    const id = `elem_${elemIndex++}`;
    const top = Math.min(950, currentY);
    const left = (elements.length % 2 === 0) ? 60 : 520;
    const width = 380;
    const height = 36;

    elements.push({
      id,
      tag: "a",
      text: innerText.slice(0, 80),
      href,
      selector: href ? `a[href*="${href.slice(0, 30)}"]` : `a:contains("${innerText.slice(0, 20)}")`,
      bbox: { top, left, width, height },
      center: { x: left + width / 2, y: top + height / 2 },
      clickable: true,
      typable: false,
    });

    currentY += 42;
    if (currentY > 920) currentY = 150;
  }

  // Extract Inputs
  const inputRegex = /<input\b([^>]*)>/gi;
  let inputMatch;
  while ((inputMatch = inputRegex.exec(html)) !== null && elements.length < 50) {
    const attrs = inputMatch[1];
    const typeMatch = attrs.match(/type=["']([^"']*)["']/i);
    const type = typeMatch ? typeMatch[1].toLowerCase() : "text";
    const placeholderMatch = attrs.match(/placeholder=["']([^"']*)["']/i);
    const placeholder = placeholderMatch ? placeholderMatch[1] : undefined;
    const nameMatch = attrs.match(/name=["']([^"']*)["']/i);
    const name = nameMatch ? nameMatch[1] : undefined;

    if (type === "hidden") continue;

    const id = `elem_${elemIndex++}`;
    const top = 70;
    const left = 200 + (elements.length % 3) * 220;
    const width = 200;
    const height = 32;

    elements.push({
      id,
      tag: "input",
      type,
      placeholder,
      text: placeholder || name || "Input Field",
      selector: name ? `input[name="${name}"]` : `input[type="${type}"]`,
      bbox: { top, left, width, height },
      center: { x: left + width / 2, y: top + height / 2 },
      clickable: true,
      typable: type !== "submit" && type !== "button" && type !== "checkbox",
    });
  }

  // Extract Buttons
  const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let btnMatch;
  while ((btnMatch = buttonRegex.exec(html)) !== null && elements.length < 60) {
    const innerText = btnMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!innerText) continue;

    const id = `elem_${elemIndex++}`;
    const top = 80;
    const left = 750;
    const width = 120;
    const height = 34;

    elements.push({
      id,
      tag: "button",
      text: innerText.slice(0, 40),
      selector: `button:contains("${innerText.slice(0, 20)}")`,
      bbox: { top, left, width, height },
      center: { x: left + width / 2, y: top + height / 2 },
      clickable: true,
      typable: false,
    });
  }

  return {
    url,
    title,
    viewport: { width: 1280, height: 800 },
    elements,
    scrollOffset: { x: 0, y: 0 },
    contentSnippet: cleanedText.slice(0, 1500),
    headings,
    capturedAt: new Date().toISOString(),
  };
}

export async function fetchAndPerceiveScreen(targetUrl: string): Promise<ScreenState> {
  let url = targetUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  const { text: rawHtml, finalUrl } = await safeFetchText(url, {
    timeoutMs: 14000,
    maxBytes: 2_500_000,
  });

  return parsePageToScreenState(rawHtml, finalUrl);
}

// ---------------------------------------------------------------------------
// Target resolution with graded semantic scoring + self-healing.
// ---------------------------------------------------------------------------

function scoreElementMatch(element: ScreenElement, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const text = (element.text || "").toLowerCase();
  const aria = (element.ariaLabel || "").toLowerCase();
  if (text === q || aria === q) return 1;
  if (text.includes(q) || aria.includes(q)) return 0.82;
  const tokens = q.split(/\s+/).filter((t) => t.length > 2);
  if (!tokens.length) return 0;
  const haystack = `${text} ${aria}`;
  const hits = tokens.filter((t) => haystack.includes(t)).length;
  return (hits / tokens.length) * 0.7;
}

function resolveTargetElement(
  action: ComputerActionStep,
  screen: ScreenState,
): { element?: ScreenElement; healed: boolean; note?: string } {
  if (action.target?.elementId) {
    const byId = screen.elements.find((e) => e.id === action.target!.elementId);
    if (byId) return { element: byId, healed: false };
  }

  if (action.target?.text) {
    const byText = screen.elements
      .map((e) => ({ e, score: Math.max(scoreElementMatch(e, action.target!.text || ""), e.ariaLabel ? scoreElementMatch(e, action.target!.text || "") : 0) }))
      .filter((m) => m.score >= 0.55)
      .sort((a, b) => b.score - a.score)[0];
    if (byText) return { element: byText.e, healed: false };
  }

  if (action.target?.selector) {
    const sel = action.target.selector.toLowerCase();
    const bySelector = screen.elements.find((e) => e.selector?.toLowerCase().includes(sel));
    if (bySelector) return { element: bySelector, healed: false };
  }

  // Fuzzy semantic fallback on the action's own description/value.
  const query = (action.description || action.value || "").toLowerCase();
  if (query) {
    const fuzzy = screen.elements
      .map((e) => ({ e, score: scoreElementMatch(e, query) }))
      .filter((m) => m.score >= 0.5)
      .sort((a, b) => b.score - a.score)[0];
    if (fuzzy) {
      return {
        element: fuzzy.e,
        healed: true,
        note: `Target resolved via semantic fallback: "${fuzzy.e.text?.slice(0, 48)}"`,
      };
    }
  }

  return { healed: false };
}

export async function executeAction(
  action: ComputerActionStep,
  currentScreen?: ScreenState,
  options?: ExecuteActionOptions,
): Promise<ActionExecutionResult> {
  const startTime = Date.now();
  const cursorFrom = options?.cursorFrom || { x: 500, y: 260 };
  const humanLike = options?.humanLike !== false;

  try {
    switch (action.action) {
      case "navigate": {
        const dest = (action.value || action.target?.text || "").trim();
        if (!dest) {
          throw new Error("Navigation target URL is required");
        }

        // Real plane: open an actual tab in the user's default browser when
        // the motor mode allows device actuation.
        const realOutcome = await attemptRealInput(options?.inputMode, async () => {
          await openUrlInDefaultBrowser(dest);
          return `Opened ${dest} in the default browser on the real device.`;
        });

        const addressBar = { x: 500, y: 30 };
        const motorPlan = humanLike
          ? buildMotorPlan(action, cursorFrom, addressBar)
          : undefined;
        const nextScreen = await fetchAndPerceiveScreen(dest);
        return {
          success: true,
          action,
          screenState: nextScreen,
          cursorPosition: addressBar,
          motorPlan,
          durationMs: Date.now() - startTime,
          real: realOutcome.real,
          realInputNote: realOutcome.note,
          output: { url: nextScreen.url, title: nextScreen.title, elementCount: nextScreen.elements.length },
        };
      }

      case "mouse_click":
      case "mouse_double_click":
      case "mouse_right_click": {
        let targetElem: ScreenElement | undefined;
        let selfHealed = false;
        let recoveryNote: string | undefined;
        let activeScreen = currentScreen;

        if (activeScreen) {
          const resolved = resolveTargetElement(action, activeScreen);
          targetElem = resolved.element;

          // Self-healing: the live page may have drifted since perception.
          // Re-perceive once and retry before giving up on the target.
          if (!targetElem && activeScreen.url) {
            try {
              const rep = await fetchAndPerceiveScreen(activeScreen.url);
              const retry = resolveTargetElement(action, rep);
              if (retry.element) {
                targetElem = retry.element;
                activeScreen = rep;
                selfHealed = true;
                recoveryNote = retry.note || "Screen re-perceived after target drift; element relocated.";
              }
            } catch {
              // Re-perception is best effort; fall through to coords.
            }
          }

          if (!selfHealed && resolved.healed && targetElem) {
            selfHealed = true;
            recoveryNote = resolved.note;
          }
        }

        const coords = action.target?.coords || targetElem?.center || { x: 500, y: 400 };
        const motorPlan = humanLike
          ? buildMotorPlan(action, cursorFrom, coords, { clickRipple: true })
          : undefined;

        // Real plane: physically click with the borrowed mouse when the gate
        // allows it (user idle or takeover). Coordinates are normalized
        // 0-1000 and mapped to the actual screen inside the bridge.
        const realButton = action.action === "mouse_right_click" ? "right" : "left";
        const realOutcome = await attemptRealInput(options?.inputMode, async () => {
          await respectHumanPace();
          await realMouseClick(options!.inputMode!, coords.x, coords.y, realButton, {
            double: action.action === "mouse_double_click",
          });
          return `${action.action === "mouse_double_click" ? "Double-clicked" : action.action === "mouse_right_click" ? "Right-clicked" : "Clicked"} at screen point (${coords.x}, ${coords.y}) with the real mouse.`;
        });

        let nextScreen = activeScreen;
        if (targetElem && targetElem.href) {
          try {
            let nextUrl = targetElem.href;
            if (activeScreen?.url && !nextUrl.startsWith("http")) {
              nextUrl = new URL(nextUrl, activeScreen.url).toString();
            }
            nextScreen = await fetchAndPerceiveScreen(nextUrl);
          } catch {
            // Stay on current screen if navigation fails
          }
        }

        return {
          success: true,
          action,
          screenState: nextScreen,
          cursorPosition: coords,
          motorPlan,
          durationMs: Date.now() - startTime,
          selfHealed,
          recoveryNote,
          real: realOutcome.real,
          realInputNote: realOutcome.note,
          output: {
            clickedElement: targetElem?.id,
            clickedText: targetElem?.text,
            coords,
            followedLink: targetElem?.href,
          },
        };
      }

      case "type_text": {
        const textToType = action.value || "";
        let targetElem: ScreenElement | undefined;
        if (currentScreen) {
          const resolved = resolveTargetElement(
            { ...action, description: action.description || textToType },
            currentScreen,
          );
          targetElem = resolved.element?.typable
            ? resolved.element
            : currentScreen.elements.find((e) => e.typable);
        }
        const coords = action.target?.coords || targetElem?.center || { x: 400, y: 70 };
        const focused: ScreenState | undefined = currentScreen
          ? { ...currentScreen, activeElementId: targetElem?.id }
          : undefined;
        const motorPlan = humanLike
          ? buildMotorPlan(action, cursorFrom, coords, {
              typingText: textToType,
              typingSurface: targetElem?.id,
            })
          : undefined;

        const realOutcome = await attemptRealInput(options?.inputMode, async () => {
          await respectHumanPace();
          await realTypeText(options!.inputMode!, textToType);
          return `Typed ${textToType.length} characters on the real keyboard.`;
        });

        return {
          success: true,
          action,
          screenState: focused,
          cursorPosition: coords,
          motorPlan,
          durationMs: Date.now() - startTime,
          real: realOutcome.real,
          realInputNote: realOutcome.note,
          output: { typed: textToType, coords, focusedElement: targetElem?.id },
        };
      }

      case "key_press": {
        const combo = action.keyCombination || "Enter";
        const coords = currentScreen?.elements.find((e) => e.id === currentScreen.activeElementId)?.center
          || { x: 500, y: 500 };
        const motorPlan = humanLike
          ? {
              cursorPath: [],
              preDelayMs: 40 + Math.round(Math.random() * 60),
              postDelayMs: 90 + Math.round(Math.random() * 90),
            }
          : undefined;

        const realOutcome = await attemptRealInput(options?.inputMode, async () => {
          await respectHumanPace();
          await realPressHotkey(options!.inputMode!, combo);
          return `Pressed ${combo} on the real keyboard.`;
        });

        return {
          success: true,
          action,
          screenState: currentScreen,
          cursorPosition: coords,
          motorPlan,
          durationMs: Date.now() - startTime,
          real: realOutcome.real,
          realInputNote: realOutcome.note,
          output: { pressed: combo, focusedElement: currentScreen?.activeElementId },
        };
      }

      case "mouse_scroll": {
        const dy = action.scrollDelta?.dy || 300;
        const nextScreen = currentScreen
          ? {
              ...currentScreen,
              scrollOffset: {
                x: currentScreen.scrollOffset.x,
                y: Math.max(0, currentScreen.scrollOffset.y + dy),
              },
            }
          : undefined;
        const motorPlan = humanLike
          ? buildMotorPlan(action, cursorFrom, { x: cursorFrom.x, y: Math.max(60, Math.min(940, cursorFrom.y + 40)) })
          : undefined;

        const realOutcome = await attemptRealInput(options?.inputMode, async () => {
          await respectHumanPace();
          await realMouseScroll(options!.inputMode!, dy);
          return `Scrolled the real mouse wheel by ${dy} units.`;
        });

        return {
          success: true,
          action,
          screenState: nextScreen,
          cursorPosition: { x: cursorFrom.x, y: cursorFrom.y },
          motorPlan,
          durationMs: Date.now() - startTime,
          real: realOutcome.real,
          realInputNote: realOutcome.note,
          output: { scrolledBy: dy, newOffset: nextScreen?.scrollOffset },
        };
      }

      case "extract_data": {
        const snippet = currentScreen?.contentSnippet || "";
        const lines = snippet.split("\n\n").filter((l) => l.trim().length > 0);
        const extractedItems = lines.slice(0, 12).map((line, idx) => ({
          index: idx + 1,
          content: line.trim(),
        }));

        return {
          success: true,
          action,
          screenState: currentScreen,
          durationMs: Date.now() - startTime,
          output: {
            extractedCount: extractedItems.length,
            items: extractedItems,
            headings: currentScreen?.headings || [],
            interactiveElements: currentScreen?.elements.length || 0,
            sourceUrl: currentScreen?.url,
          },
        };
      }

      case "run_cli": {
        const cmd = action.value || "node -v";
        // Enforce safe command execution (extended guardrail vocabulary).
        const blockedPattern = isBlockedCommand(cmd);
        if (blockedPattern) {
          throw new Error(`Command blocked by security guardrails: forbidden pattern '${blockedPattern}'`);
        }

        try {
          const { stdout, stderr } = await execAsync(cmd, { timeout: 15000 });
          return {
            success: true,
            action,
            screenState: currentScreen,
            durationMs: Date.now() - startTime,
            output: {
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              command: cmd,
            },
          };
        } catch (execErr) {
          return {
            success: false,
            action,
            screenState: currentScreen,
            durationMs: Date.now() - startTime,
            error: execErr instanceof Error ? execErr.message : "Command execution failed",
          };
        }
      }

      case "wait_for": {
        const delay = Math.min(action.timeoutMs || 1000, 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));

        return {
          success: true,
          action,
          screenState: currentScreen,
          durationMs: delay,
          output: { waitedMs: delay },
        };
      }

      case "take_screenshot": {
        // Vision frame: a bounded perceptual snapshot the debrief and logs can cite.
        const frame = {
          url: currentScreen?.url,
          title: currentScreen?.title,
          headings: (currentScreen?.headings || []).slice(0, 6),
          interactiveElements: currentScreen?.elements.length || 0,
          scrollOffset: currentScreen?.scrollOffset,
          timestamp: new Date().toISOString(),
        };

        // Real plane: screen capture is read-only, so it runs whenever the
        // device bridge is available regardless of motor mode.
        let artifact: { name: string; url: string; bytes: number } | undefined;
        let realInputNote: string | undefined;
        if (isWindows()) {
          try {
            const shot = await takeScreenScreenshot(`agent_${Date.now()}`);
            artifact = { name: shot.name, url: shot.url, bytes: shot.bytes };
          } catch (err) {
            realInputNote = err instanceof Error ? `Screen capture failed: ${err.message}` : "Screen capture failed.";
          }
        } else {
          realInputNote = "Real screen capture requires the Windows device bridge.";
        }

        return {
          success: true,
          action,
          screenState: currentScreen,
          cursorPosition: cursorFrom,
          durationMs: Date.now() - startTime,
          real: Boolean(artifact),
          realInputNote,
          output: { frame, artifact },
        };
      }

      default: {
        return {
          success: true,
          action,
          screenState: currentScreen,
          durationMs: Date.now() - startTime,
          output: {
            url: currentScreen?.url,
            title: currentScreen?.title,
            timestamp: new Date().toISOString(),
          },
        };
      }
    }
  } catch (err) {
    return {
      success: false,
      action,
      screenState: currentScreen,
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : "Action failed",
    };
  }
}
