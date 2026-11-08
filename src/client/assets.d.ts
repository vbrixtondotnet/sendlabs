/** Image imports resolve to the URL Vite serves them from. */
declare module "*.png" {
  const src: string;
  export default src;
}
