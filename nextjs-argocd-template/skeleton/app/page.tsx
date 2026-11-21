export default function Home() {
  return (
    <main className="container">
      <h1>${{ values.componentId }}</h1>
      <p>${{ values.description }}</p>
      <p>
        Scaffolded with Backstage. Edit <code>app/page.tsx</code> to get started.
      </p>
    </main>
  );
}
