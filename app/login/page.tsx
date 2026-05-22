import { redirect } from "next/navigation";

// Password gate removed. Anyone landing on /login (old bookmark, stale
// redirect) gets bounced to the dashboard root.
export default function LoginPage() {
  redirect("/");
}
