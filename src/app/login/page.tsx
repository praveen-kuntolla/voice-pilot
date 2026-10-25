"use client";

import Link from "next/link";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {SiteNav} from "@/components/site-nav";
import {createSupabaseBrowserClient} from "@/lib/supabase/browser";

export default function Login(){
  const router=useRouter();
  const [hydrated,setHydrated]=useState(false);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [callbackError,setCallbackError]=useState(false);
  useEffect(()=>{
    setHydrated(true);
    const errorCode=new URLSearchParams(window.location.search).get("error");
    setCallbackError(errorCode==="callback"||errorCode==="configuration");
  },[]);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!hydrated)return;
    setBusy(true);setError("");
    try{
      const f=new FormData(e.currentTarget);
      const email=String(f.get("email")||"").trim().toLowerCase();
      const password=String(f.get("password")||"");
      const {error:authError}=await createSupabaseBrowserClient().auth.signInWithPassword({email,password});
      if(authError){setError(authError.message);return}
      const next=new URLSearchParams(window.location.search).get("next");
      router.replace(next?.startsWith("/")&&!next.startsWith("//")?next:"/dashboard");
      router.refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to log in. Please try again.");}
    finally{setBusy(false)}
  }
  return <><SiteNav/><main className="container"><div className="form-wrap"><div className="eyebrow">Welcome back</div><h1>Log in to your workspace.</h1><form method="post" onSubmit={submit}><label className="label">Email<input className="input" name="email" type="email" autoComplete="email" required/></label><label className="label">Password<input className="input" name="password" type="password" autoComplete="current-password" required minLength={8}/></label><button className="btn primary" disabled={!hydrated||busy}>{busy?"Logging in…":"Log in"}</button></form>{(error||callbackError)&&<p className="muted" role="alert" style={{color:"#fca5a5"}}>{error||"Authentication is unavailable until local Supabase is configured, or the authentication link has expired."}</p>}<p className="muted"><Link href="/forgot-password">Forgot password?</Link> · <Link href="/signup">Create an account</Link></p></div></main></>;
}
