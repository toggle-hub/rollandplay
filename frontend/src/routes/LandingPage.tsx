import { Fragment, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUpRight, ArrowRight, BookOpen, DiceFive, Eye, Sparkle, UsersThree } from "@phosphor-icons/react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Brand } from "../components/Brand";
import tableMap from "../assets/landing-map.webp";
import tableChat from "../assets/landing-chat.webp";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const landscape = "https://picsum.photos/seed/adventure/1920/1080";
const highlights = ["SHARED MAPS", "FOG OF WAR", "DICE ROLLED FOR YOU", "D&D 5E RULES"];
const features = [
  { icon: Eye, title: "Shared map with fog of war", text: "Everyone plays on the same map. Walls and closed doors block sight, so each player sees only what their character can see." },
  { icon: DiceFive, title: "Attacks and damage rolled for you", text: "Pick an attack and a target. The hit roll, the damage and the new hit points land in the table chat for everyone." },
  { icon: BookOpen, title: "Built-in D&D 5e rules", text: "Classes, weapons, spells and monsters from the 5e SRD are ready to use. Running another game? Write your own rule book." },
  { icon: UsersThree, title: "Play in the browser with friends", text: "Nothing to install. Sign in with your email, then invite your friends by username or share the room code." },
];

export function LandingPage() {
  const root = useRef<HTMLElement>(null);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(".hero-enter", { y: 28, opacity: 0, duration: 1, stagger: 0.13, ease: "power3.out", clearProps: "all" });
      gsap.utils.toArray<HTMLElement>(".scroll-image").forEach((image) => {
        gsap.timeline({ scrollTrigger: { trigger: image.parentElement, start: "top 95%", end: "bottom top", scrub: 0.6 } })
          .fromTo(image, { scale: 0.8, opacity: 0.6 }, { scale: 1, opacity: 1, duration: 0.45 })
          .to(image, { scale: 1.04, opacity: 0.2, filter: "brightness(0.45)", duration: 0.55 });
      });
      gsap.to(".marquee-track", { xPercent: -50, duration: 35, ease: "none", repeat: -1 });
    });
    media.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
      ScrollTrigger.create({ trigger: ".journey-layout", start: "top 130px", end: "bottom bottom", pin: ".journey-heading", pinSpacing: false });
    });
    return () => media.revert();
  }, { scope: root });

  return (
    <main id="main-content" ref={root} className="landing overflow-x-hidden w-full max-w-full">
      <section className="hero section-container">
        <div className="hero-orbit" aria-hidden="true" />
        <div className="hero-photo group overflow-hidden">
          <img src={landscape} alt="" fetchPriority="high" className="transition-transform duration-700 ease-out group-hover:scale-105" />
          <div className="hero-photo-wash" />
          <svg className="hero-compass" viewBox="0 0 320 320" fill="none" aria-hidden="true">
            <circle cx="160" cy="160" r="149" stroke="currentColor" strokeWidth="0.7" />
            <circle cx="160" cy="160" r="126" stroke="currentColor" strokeWidth="0.7" strokeDasharray="1 9" />
            <path d="m160 39 105 61v121l-105 61-105-61V100L160 39Zm0 0 65 182H95L160 39ZM55 100h210M55 100l40 121 65 61 65-61 40-121M95 221l65-121 65 121" stroke="currentColor" strokeWidth="1" />
            <path d="M160 0v23m0 274v23M0 160h23m274 0h23" stroke="currentColor" />
          </svg>
          <span className="hero-image-caption">There’s a whole world out there.</span>
        </div>
        <div className="hero-content">
          <p className="hero-enter hero-kicker"><span /> A virtual tabletop for D&amp;D 5e and your own games</p>
          <h1 className="hero-enter max-w-6xl w-full">Good company.<br /><span>Great adventures.</span></h1>
          <p className="hero-enter hero-description">Gather your party around one shared map, right in the browser.<br className="hidden sm:block" /> Move your tokens, pick an attack, and let the dice and the rules keep score.</p>
          <div className="hero-enter hero-actions">
            <Link className="btn" to="/login">Sign in to play <ArrowUpRight size={19} aria-hidden="true" /></Link>
            <a className="hero-text-link" href="#experience">See how it plays <ArrowDown size={17} aria-hidden="true" /></a>
          </div>
        </div>
        <div className="hero-bottom"><span>Made for the way you play.</span><a href="#experience" aria-label="See how Rollandplay works"><ArrowDown size={20} aria-hidden="true" /></a><span>Tabletop spirit. Anywhere.</span></div>
      </section>

      <div className="marquee" aria-label="Shared maps, fog of war, dice rolled for you, D&D 5e rules">
        <div className="marquee-track" aria-hidden="true">
          {[0, 1].map((copy) => <div className="marquee-group" key={copy}>{highlights.map((label) => <Fragment key={label}><span>{label}</span><Sparkle weight="fill" /></Fragment>)}</div>)}
        </div>
      </div>

      <section id="experience" className="section-container chapter" aria-labelledby="experience-heading">
        <div className="section-intro">
          <h2 id="experience-heading">Your whole table,<br /><span className="accent-italic">in one browser tab.</span></h2>
          <p>Draw the dungeon, drop in the party and the monsters, and play. These are real screens from a game in progress.</p>
        </div>
        <div className="feature-showcase">
          <figure className="feature-shot">
            <div className="feature-frame"><img src={tableMap} width={1512} height={1008} loading="lazy" alt="A dungeon map seen by a player: the room where his character stands is lit, a cone of sight reaches through an open door to a goblin, and the rest of the map stays dark." /></div>
            <figcaption>What a player sees: walls block sight, and the rest stays dark.</figcaption>
          </figure>
          <figure className="feature-shot feature-shot-chat">
            <div className="feature-frame"><img src={tableChat} width={556} height={776} loading="lazy" alt="The table chat: Brannoc attacks a goblin with a light crossbow, rolls 19 to hit, and deals 1 piercing damage." /></div>
            <figcaption>Every attack and roll lands in the chat.</figcaption>
          </figure>
        </div>
        <ul className="feature-list">
          {features.map(({ icon: Icon, title, text }) => <li key={title}><Icon size={28} weight="light" aria-hidden="true" /><h3>{title}</h3><p>{text}</p></li>)}
        </ul>
      </section>

      <section className="journey-section chapter">
        <div className="section-container journey-layout">
          <div className="journey-heading"><p className="eyebrow">A shared escape</p><h2>Some nights<br />stay with you.</h2><p>Turn a little free time into a world of possibility. All it takes is a spark, a story, and your favorite people.</p><Link to="/login" className="text-action">Sign in and start a game <ArrowUpRight size={21} aria-hidden="true" /></Link></div>
          <div className="journey-gallery">
            <figure><div className="journey-image overflow-hidden"><img className="scroll-image" src={landscape} alt="A rocky coast stretching into the distance" loading="lazy" /></div><figcaption><span>Somewhere beyond the everyday.</span><span aria-hidden="true">↗</span></figcaption></figure>
            <figure><div className="journey-image journey-image-second overflow-hidden"><img className="scroll-image" src="https://picsum.photos/seed/tabletop/1920/1080" alt="Waves flowing through a passage of weathered pillars" loading="lazy" /></div><figcaption><span>A story only your party could tell.</span><span aria-hidden="true">↗</span></figcaption></figure>
          </div>
        </div>
      </section>

      <section className="final-cta section-container"><p className="eyebrow">The best stories start together</p><h2>Save a seat.<br /><span>Start a story.</span></h2><Link className="btn" to="/login">Sign in to play <ArrowRight size={20} aria-hidden="true" /></Link><p className="cta-note">Sign in with your email. No password needed.</p><div className="cta-orbit" aria-hidden="true" /></section>
      <footer className="site-footer section-container"><Link to="/" aria-label="Rollandplay home"><Brand /></Link><p>A little less ordinary. A little more adventure.</p><a href="#experience">See how it plays <ArrowUpRight size={16} aria-hidden="true" /></a></footer>
    </main>
  );
}
