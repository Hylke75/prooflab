"use client";

import { useEffect } from "react";

// Eén klein client-eiland voor alle scrollgedrag op de publieke voorkant. Werkt via data-attributen, zodat de
// secties zelf server-componenten blijven. Zonder JavaScript of met prefers-reduced-motion is alle inhoud
// gewoon zichtbaar: de verborgen beginstand van onthullingen geldt alleen onder [data-motion="on"].
//
//  data-header    krijgt data-scrolled zodra de pagina gescrold is, en data-tone="dark" boven een donkere
//                 sectie (data-dark-section), zodat de kop daar leesbaar en rustig blijft
//  data-reveal    krijgt data-in zodra het element in beeld komt (één keer)
//  data-scrub     krijgt --progress (0–1) op basis van de positie in het venster
//  data-steps     krijgt data-active (stapnummer) en --steps (0–1); stappen dragen data-step
//  data-magnetic  beweegt licht mee met de muis (alleen fijne aanwijzer)
//  data-spot      krijgt --mx/--my voor een lichtvlek onder de muis (alleen fijne aanwijzer)
//  data-parallax  verschuift met een factor van de scrollpositie (alleen desktop)
export function LandingMotion({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const wide = window.matchMedia("(min-width: 901px)").matches;
    const cleanups: (() => void)[] = [];
    const clamp = (v: number) => Math.min(1, Math.max(0, v));

    // Onthullingen: wat al in beeld staat, wordt direct als zichtbaar gemarkeerd (geen flits bij het laden).
    const reveals = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (reduce || !("IntersectionObserver" in window)) {
      for (const el of reveals) el.dataset.in = "";
    } else {
      const vh = window.innerHeight;
      for (const el of reveals) {
        const r = el.getBoundingClientRect();
        if (r.top < vh * 0.92 && r.bottom > 0) el.dataset.in = "";
      }
      root.dataset.motion = "on";
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            (e.target as HTMLElement).dataset.in = "";
            io.unobserve(e.target);
          }
        },
        { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
      );
      for (const el of reveals) if (!("in" in el.dataset)) io.observe(el);
      cleanups.push(() => io.disconnect());
    }

    const header = root.querySelector<HTMLElement>("[data-header]");
    const darkSections = Array.from(root.querySelectorAll<HTMLElement>("[data-dark-section]"));
    const scrubs = reduce ? [] : Array.from(root.querySelectorAll<HTMLElement>("[data-scrub]"));
    const stepsBox = root.querySelector<HTMLElement>("[data-steps]");
    const steps = stepsBox ? Array.from(stepsBox.querySelectorAll<HTMLElement>("[data-step]")) : [];
    const parallax = reduce || !wide ? [] : Array.from(root.querySelectorAll<HTMLElement>("[data-parallax]"));

    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      if (header) {
        if (window.scrollY > 12) header.dataset.scrolled = "";
        else delete header.dataset.scrolled;
        const line = header.getBoundingClientRect().bottom - 8;
        const overDark = darkSections.some((el) => {
          const r = el.getBoundingClientRect();
          return r.top <= line && r.bottom >= line;
        });
        if (overDark) header.dataset.tone = "dark";
        else delete header.dataset.tone;
      }
      for (const el of scrubs) {
        const r = el.getBoundingClientRect();
        // 0 als de bovenkant onderin het venster staat, 1 als het blok tot boven het midden is gescrold.
        el.style.setProperty("--progress", clamp((vh * 0.9 - r.top) / (r.height + vh * 0.35)).toFixed(3));
      }
      if (stepsBox && steps.length) {
        let active = 0;
        steps.forEach((s, i) => {
          if (s.getBoundingClientRect().top < vh * 0.55) active = i;
        });
        if (stepsBox.dataset.active !== String(active)) stepsBox.dataset.active = String(active);
        const first = steps[0].getBoundingClientRect();
        const last = steps[steps.length - 1].getBoundingClientRect();
        const span = last.top - first.top || 1;
        stepsBox.style.setProperty("--steps", clamp((vh * 0.55 - first.top) / span).toFixed(3));
      }
      for (const el of parallax) {
        const factor = Number(el.dataset.parallax) || 0;
        const y = Math.min(window.scrollY, vh * 1.2) * factor;
        el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    cleanups.push(() => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    });

    // Magnetische knoppen en lichtvlekken: alleen met een muis, nooit bij reduced motion.
    if (fine && !reduce) {
      for (const el of root.querySelectorAll<HTMLElement>("[data-magnetic]")) {
        const move = (e: PointerEvent) => {
          const r = el.getBoundingClientRect();
          const dx = e.clientX - (r.left + r.width / 2);
          const dy = e.clientY - (r.top + r.height / 2);
          el.style.transform = `translate3d(${(dx * 0.22).toFixed(1)}px, ${(dy * 0.32).toFixed(1)}px, 0)`;
        };
        const leave = () => {
          el.style.transform = "";
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerleave", leave);
        cleanups.push(() => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerleave", leave);
        });
      }
      for (const el of root.querySelectorAll<HTMLElement>("[data-spot]")) {
        const move = (e: PointerEvent) => {
          const r = el.getBoundingClientRect();
          el.style.setProperty("--mx", `${(e.clientX - r.left).toFixed(0)}px`);
          el.style.setProperty("--my", `${(e.clientY - r.top).toFixed(0)}px`);
        };
        el.addEventListener("pointermove", move);
        cleanups.push(() => el.removeEventListener("pointermove", move));
      }
    }

    return () => {
      for (const c of cleanups) c();
      delete root.dataset.motion;
    };
  }, [rootId]);

  return null;
}
