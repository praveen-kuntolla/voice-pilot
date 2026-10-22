"use client";

import Link from "next/link";
import {useEffect,useState} from "react";
import {SiteNav} from "@/components/site-nav";
import {createSupabaseBrowserClient} from "@/lib/supabase/browser";

export default function Signup(){
  const [hydrated,setHydrated]=useState(false);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>setHydrated(true),[]);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!hydrated)return;
    setBusy(true);
    try{
      const f=new FormData(e.currentTarget);
      const {error}=await createSupabaseBrowserClient().auth.signUp({email:String(f.get("email")),password:String(f.get("password")),options:{data:{full_name:String(f.get("name"))},emailRedirectTo:`${location.origin}/auth/callback?next=/onboarding`}});
      setMessage(error?.message||"Check your email to confirm your account.");
    }catch{setMessage("Unable to create an account. Please try again.")}
    finally{setBusy(false)}
  }
  return <><SiteNav/><main className="container"><div className="form-wrap"><div className="eyebrow">Start your workspace</div><h1>Create your account.</h1><form method="post" onSubmit={submit}><label className="label">Full name<input className="input" name="name" required/></label><label className="label">Work email<input className="input" name="email" type="email" required/></label><label className="label">Password<input className="input" name="password" type="password" minLength={8} required/></label><button className="btn primary" disabled={!hydrated||busy}>{busy?"Creating…":"Create account"}</button></form>{message&&<p className="notice">{message}</p>}<p className="muted">Already have an account? <Link href="/login">Log in</Link></p></div></main></>;
}
