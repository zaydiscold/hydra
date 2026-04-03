# Comet Animation Logic
*A breakdown of the pure CSS neo-brutalist shooting stars used in Hydra.*

To drop those exact same neo-brutalist shooting stars into another website, here is the breakdown of the exact CSS "trick" used. It's surprisingly lightweight and only requires pure CSS.

## The Magic Formula

**1. The Shape & Tail:** 
You make a very thin, tall `div` (e.g., `width: 2px; height: 150px;`), and instead of a solid background color, you use a `linear-gradient`. By fading from a solid neon color at the bottom to `transparent` at the top, you instantly get a perfect, fading comet tail!

**2. The Glowing Head:** 
You add a `box-shadow` matching the solid neon color to make the head bloom with an EDM/Cyberpunk glow.

**3. The Diagonal Physics:** 
Instead of trying to animate the X and Y coordinates mathematically, you just permanently tilt the entire comet diagonally using `transform: rotate(45deg)`.

**4. The Movement:**  
Because the object is permanently tilted 45 degrees, you can just animate its `translateY` property from `0` down to well past the viewport height. In Hydra the travel distance is intentionally longer than the visible screen so the streak can cross more of the viewport before fading out.

---

## Boilerplate Code

Here is the exact drop-in code you can use on any HTML/CSS site:

### The HTML
```html
<div class="meteor-container">
  <div class="meteor"></div>
  <div class="meteor"></div>
  <div class="meteor"></div>
</div>
```

### The CSS
```css
/* Container to keep them behind content */
.meteor-container {
  position: fixed;
  top: 0; 
  left: 0; 
  width: 100vw; 
  height: 100vh;
  pointer-events: none;
  z-index: -1;
  overflow: hidden;
}

/* The actual shooting star */
.meteor {
  position: absolute;
  top: -150px; /* Start it hidden above the screen */
  width: 2px;
  height: 150px;
  background: linear-gradient(to top, #00ffff, transparent); /* Cyan fading tail */
  box-shadow: 0 0 15px #00ffff; /* Neon glow */
  opacity: 0;
  animation: meteorFall linear infinite;
  border-radius: 50%; /* Smooths the head */
}

/* Stagger their starting positions and speeds to make it organic */
.meteor:nth-child(1) { left: 80%; animation-duration: 5s; animation-delay: 0s; }
.meteor:nth-child(2) { left: 40%; animation-duration: 9s; animation-delay: 2s; background: linear-gradient(to top, #ff00ff, transparent); box-shadow: 0 0 15px #ff00ff; }
.meteor:nth-child(3) { left: 90%; animation-duration: 6s; animation-delay: 4s; }

/* The Flight Animation */
@keyframes meteorFall {
  0% { transform: rotate(45deg) translateY(0); opacity: 0; }
  2% { opacity: 1; } /* Ignites quickly */
  15% { transform: rotate(45deg) translateY(280vh); opacity: 0; } /* Shoots diagonally and burns out */
  100% { transform: rotate(45deg) translateY(280vh); opacity: 0; } /* Waits for the loop */
}
```
