// Files compiled into the .exe (Bun's `with { type: "file" }` gives their path).
declare module "*.dll" {
  const path: string;
  export default path;
}
declare module "*.ico" {
  const path: string;
  export default path;
}
declare module "*.ps1" {
  const path: string;
  export default path;
}
