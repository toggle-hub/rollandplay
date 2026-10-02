import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUpRight, ArrowRight, Plus, Minus, Compass, Sparkle } from "@phosphor-icons/react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Brand } from "../components/Brand";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const landscape = "https://picsum.photos/seed/adventure/1920/1080";
const stories = [
  { title: "Find your people.", text: "Old friends. New characters. A shared reason to make time for one more adventure.", image: "https://picsum.photos/seed/adventure/1920/1080", caption: "A little further, together" },
  { title: "Follow the unknown.", text: "A path without a name. A door left open. The best stories start with a little curiosity.", image: "https://picsum.photos/seed/tabletop/1920/1080", caption: "Leave the familiar behind" },
  { title: "Make it your story.", text: "No two parties take the same path. Bring your imagination and see where the evening goes.", image: "https://picsum.photos/seed/horizon/1920/1080", caption: "Every choice, a new chapter" },
];

export function LandingPage() {
  const root = useRef<HTMLElement>(null);
  const [activeStory, setActiveStory] = useState(0);

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
          <img src={landscape} alt="Waves breaking against a rugged coastline" fetchPriority="high" className="transition-transform duration-700 ease-out group-hover:scale-105" />
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
          <p className="hero-enter hero-kicker"><span /> Your people. Your story. Your table.</p>
          <h1 className="hero-enter max-w-6xl w-full">Good company.<br /><span>Great adventures.</span></h1>
          <p className="hero-enter hero-description">A home for the stories you tell together.<br className="hidden sm:block" /> Gather your party. Leave the ordinary behind.</p>
          <div className="hero-enter hero-actions">
            <Link className="btn" to="/login">Find your next adventure <ArrowUpRight size={19} aria-hidden="true" /></Link>
            <a className="hero-text-link" href="#experience">Take a look around <ArrowDown size={17} aria-hidden="true" /></a>
          </div>
        </div>
        <div className="hero-bottom"><span>Made for the way you play.</span><a href="#experience" aria-label="Explore the Rollandplay experience"><ArrowDown size={20} aria-hidden="true" /></a><span>Tabletop spirit. Anywhere.</span></div>
      </section>

      <div className="marquee" aria-label="For the storytellers, world builders, and good company">
        <div className="marquee-track" aria-hidden="true">
          {[0, 1].map((copy) => <div className="marquee-group" key={copy}><span>STORYTELLERS</span><Sparkle weight="fill" /><span>WORLD BUILDERS</span><Sparkle weight="fill" /><span>GOOD COMPANY</span><Sparkle weight="fill" /></div>)}
        </div>
      </div>

      <section id="experience" className="section-container chapter">
        <div className="section-intro">
          <h2>A little imagination.<br />An entire <span className="inline-world"><img src="https://picsum.photos/seed/adventure/1920/1080" alt="" loading="lazy" /></span> world.</h2>
          <p>It’s never just a game. It’s the unexpected turn, the impossible plan, and the people who make it unforgettable.</p>
        </div>
        <div className="story-bento grid grid-flow-dense md:grid-cols-3 md:grid-rows-2">
          <article className="bento-art md:row-span-2 group overflow-hidden">
            <img src="https://picsum.photos/seed/horizon/1920/1080" alt="Leather bags and tools laid out for an expedition" loading="lazy" className="transition-transform duration-700 ease-out group-hover:scale-105" />
            <div className="bento-art-overlay" />
            <Compass className="bento-compass" size={44} weight="thin" aria-hidden="true" />
            <div><p className="bento-small">An invitation to get lost</p><h3>The real world<br />can wait.</h3></div>
          </article>
          <article className="bento-copy md:col-span-2"><span className="bento-rule" /><h3>Less ordinary.<br />More “remember when?”</h3><p>The best part of any adventure isn’t the destination. It’s the story you’re still telling long after the night is over.</p></article>
          <article className="bento-quote md:col-span-2"><Sparkle size={32} weight="thin" aria-hidden="true" /><div><h3>Bring yourself.<br />Become someone else.</h3><p>Every great story has room for another character.</p></div></article>
        </div>
      </section>

      <section className="journey-section chapter">
        <div className="section-container journey-layout">
          <div className="journey-heading"><p className="eyebrow">A shared escape</p><h2>Some nights<br />stay with you.</h2><p>Turn a little free time into a world of possibility. All it takes is a spark, a story, and your favorite people.</p><Link to="/login" className="text-action">Make a little magic <ArrowUpRight size={21} aria-hidden="true" /></Link></div>
          <div className="journey-gallery">
            <figure><div className="journey-image overflow-hidden"><img className="scroll-image" src={landscape} alt="A rocky coast stretching into the distance" loading="lazy" /></div><figcaption><span>Somewhere beyond the everyday.</span><span aria-hidden="true">↗</span></figcaption></figure>
            <figure><div className="journey-image journey-image-second overflow-hidden"><img className="scroll-image" src="https://picsum.photos/seed/tabletop/1920/1080" alt="Waves flowing through a passage of weathered pillars" loading="lazy" /></div><figcaption><span>A story only your party could tell.</span><span aria-hidden="true">↗</span></figcaption></figure>
          </div>
        </div>
      </section>

      <section className="section-container chapter possibility-section">
        <div className="section-intro"><h2>There’s no right way.<br />Just <span className="accent-italic">your way.</span></h2><p>Take the scenic route. Try the unlikely plan. The next chapter is yours to write.</p></div>
        <div className="story-accordion">
          {stories.map((story, index) => <article key={story.title} onMouseEnter={() => setActiveStory(index)} className={`story-slice group overflow-hidden ${activeStory === index ? "is-active" : ""}`}>
            <img src={story.image} alt="" loading="lazy" className="transition-transform duration-700 ease-out group-hover:scale-105" />
            <div className="slice-wash" />
            <button type="button" aria-expanded={activeStory === index} aria-controls={`story-panel-${index}`} onClick={() => setActiveStory(index)} className="slice-trigger"><span>{story.title}</span>{activeStory === index ? <Minus size={22} aria-hidden="true" /> : <Plus size={22} aria-hidden="true" />}</button>
            <div id={`story-panel-${index}`} className="slice-content" hidden={activeStory !== index}><p>{story.text}</p><span>{story.caption}</span></div>
          </article>)}
        </div>
      </section>

      <section className="final-cta section-container"><p className="eyebrow">The best stories start together</p><h2>Save a seat.<br /><span>Start a story.</span></h2><Link className="btn" to="/login">Your adventure begins here <ArrowRight size={20} aria-hidden="true" /></Link><p className="cta-note">Sign in with your email. Bring your imagination.</p><div className="cta-orbit" aria-hidden="true" /></section>
      <footer className="site-footer section-container"><Link to="/" aria-label="Rollandplay home"><Brand /></Link><p>A little less ordinary. A little more adventure.</p><a href="#experience">Back to the story <ArrowUpRight size={16} aria-hidden="true" /></a></footer>
    </main>
  );
}
