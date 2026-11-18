# Media

<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Product tour" allow="autoplay" allowfullscreen></iframe>

<iframe src="https://tracker.example.com/widget" title="Other site"></iframe>

<video autoPlay muted loop playsInline src="videos/loop.mp4"></video>

<img src="images/sample.png" alt="No zoom" noZoom />

<img className="block dark:hidden" src="images/sample.png" alt="Light only" />
<img className="hidden dark:block" src="images/sample.png" alt="Dark only" />

![Dark by suffix](images/sample.png#gh-dark-mode-only)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/sample.png?dark" />
  <img src="images/sample.png?light" alt="Picture" />
</picture>
