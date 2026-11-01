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
  const [showPassword,setShowPassword]=useState(false);
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
      if(!email||!password){setError("Enter your email and password to continue.");return}
      const {error:authError}=await createSupabaseBrowserClient().auth.signInWithPassword({email,password});
      if(authError){setError(authError.message);return}
      const next=new URLSearchParams(window.location.search).get("next");
      router.replace(next?.startsWith("/")&&!next.startsWith("//")?next:"/dashboard");
      router.refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to log in. Please try again.");}
    finally{setBusy(false)}
  }
  return <><SiteNav/><main className="container"><div className="form-wrap"><div className="eyebrow">VoicePilot AI · Secure workspace access</div><h1>Log in to your workspace.</h1><p className="muted">Continue to your organization dashboard and simulation tools.</p><form method="post" onSubmit={submit} noValidate><label className="label" htmlFor="login-email">Email<input id="login-email" className="input" name="email" type="email" autoComplete="email" required aria-describedby="login-help"/></label><label className="label" htmlFor="login-password">Password<div style={{position:"relative"}}><input id="login-password" className="input" style={{paddingRight:92}} name="password" type={showPassword?"text":"password"} autoComplete="current-password" required minLength={8}/><button className="btn ghost" style={{position:"absolute",right:7,top:7,padding:"6px 8px",fontSize:12}} type="button" onClick={()=>setShowPassword(value=>!value)} aria-controls="login-password" aria-pressed={showPassword}>{showPassword?"Hide":"Show"}</button></div></label><button className="btn primary" style={{width:"100%",justifyContent:"center"}} disabled={!hydrated||busy}>{busy?"Logging in…":"Log in"}</button></form><p id="login-help" className="muted" style={{fontSize:13}}>Your credentials are handled by the configured Supabase Auth service.</p>{(error||callbackError)&&<p className="muted" role="alert" style={{color:"#fca5a5"}}>{error||"Authentication is unavailable until local Supabase is configured, or the authentication link has expired."}</p>}<p className="muted"><Link href="/forgot-password">Forgot password?</Link> · <Link href="/signup">Create an account</Link></p></div></main></>;
}
