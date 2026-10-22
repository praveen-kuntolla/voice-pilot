"use client";

import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {SiteNav} from "@/components/site-nav";
import {createSupabaseBrowserClient} from "@/lib/supabase/browser";

export default function Reset(){
  const [hydrated,setHydrated]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const router=useRouter();
  useEffect(()=>setHydrated(true),[]);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!hydrated)return;
    setBusy(true);
    try{
      const password=String(new FormData(e.currentTarget).get("password"));
      const {error}=await createSupabaseBrowserClient().auth.updateUser({password});
      if(error)setMessage(error.message);
      else{setMessage("Password updated.");setTimeout(()=>router.push("/dashboard"),700)}
    }catch{setMessage("Unable to update your password. Please try again.")}
    finally{setBusy(false)}
  }
  return <><SiteNav/><main className="container"><div className="form-wrap"><div className="eyebrow">Account recovery</div><h1>Choose a new password.</h1><form method="post" onSubmit={submit}><label className="label">New password<input className="input" name="password" type="password" minLength={8} required/></label><button className="btn primary" disabled={!hydrated||busy}>{busy?"Updating…":"Update password"}</button></form>{message&&<p className="notice">{message}</p>}</div></main></>;
}
