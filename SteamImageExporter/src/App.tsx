import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import { invoke } from "@tauri-apps/api/core";

function App() {
  return (
    <div style={{ padding: 20 }}>
      <h1>Steam Image Tool</h1>

      <button
        onClick={async () => {
          const res = await invoke<string>("ping", { name: "GAI" });
          console.log(res);
          alert(res);
        }}
      >
        Ping Rust
      </button>
    </div>
  );
}

export default App;
