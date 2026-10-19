'use client';

import { useState, useCallback, useEffect, useId } from 'react';
import {
  Users,
  TrendingUp,
  ShoppingBag,
  Clock,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Download,
  Search,
  RotateCcw,
  X,
  ChevronUp,
  ChevronDown,
  Calendar,
  Banknote,
} from 'lucide-react';

// Types
type SelisihLaciCount = { hijau: number; kuning: number; merah: number; overage: number };
type KasirSummary = {
  kasirId: string; kasirName: string; kasirNim: string; jabatan: string;
  totalShift: number; totalOmzet: number; totalHpp: number; totalLabaKotor: number;
  totalTxCount: number; totalVoidCount: number; totalTxCash: number; totalTxQris: number;
  totalPenjualanCash: number; totalPenjualanQris: number; totalModalAwal: number;
  avgOmzetPerShift: number; topProduk: string; totalDurasiMenit: number;
  selisihLaciCount: SelisihLaciCount;
};
type ShiftDetail = {
  shiftId: string; employeeId: string; clockIn: string; clockOut: string | null;
  status: string; durasiMenit: number | null; modalAwal: number; omzet: number;
  hpp: number; labaKotor: number; txCount: number; voidCount: number;
  txCountCash: number; txCountQris: number; cashSales: number; cashOut: number;
  cashIn: number; expectedCash: number; actualCash: number | null;
  discrepancy: number | null; statusLaci: string; discrepancyTier: string;
  serahTerimaDiff: number | null; auditFlags: string;
};
type RekapData = { dateFrom: string; dateTo: string; totalKasir: number; summary: KasirSummary[]; shiftDetails: ShiftDetail[]; };

// Helpers
function rp(num: number): string { return 'Rp\u00a0' + Math.round(num).toLocaleString('id-ID'); }
// CRITICAL FIX: SQL COUNT() returns string from pg driver. Always parse.
function n(v: unknown): number { const x = typeof v === 'number' ? v : Number(v); return isNaN(x) ? 0 : x; }
function dur(m: number | null): string { if (!m) return '\u2014'; const h = Math.floor(m/60); const mn = m%60; return h ? `${h}j ${mn}m` : `${mn}m`; }
function fdt(iso: string | null): string { if (!iso) return '\u2014'; return new Date(iso).toLocaleString('id-ID',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}); }
const TS: Record<string,{color:string;bg:string;border:string}> = {
  HIJAU:   {color:'#16a34a',bg:'#dcfce7',border:'#86efac'},
  KUNING:  {color:'#d97706',bg:'#fef3c7',border:'#fcd34d'},
  MERAH:   {color:'#dc2626',bg:'#fee2e2',border:'#fca5a5'},
  OVERAGE: {color:'#0284c7',bg:'#dbeafe',border:'#93c5fd'},
  RUNNING: {color:'#6b7280',bg:'#f3f4f6',border:'#d1d5db'},
};
function todayW(): string { return new Date(Date.now()+7*3600000).toISOString().slice(0,10); }
function prevW(): string { return new Date(Date.now()+7*3600000-6*86400000).toISOString().slice(0,10); }

export default function RekapKasir() {
  const uid = useId();
  const [dateFrom,setDateFrom] = useState(prevW());
  const [dateTo,setDateTo] = useState(todayW());
  const [searchQ,setSearchQ] = useState('');
  const [data,setData] = useState<RekapData|null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [detailKasir,setDetailKasir] = useState<KasirSummary|null>(null);
  const [sortKey,setSortKey] = useState<'totalOmzet'|'totalShift'|'totalTxCount'|'avgOmzetPerShift'>('totalOmzet');
  const [sortDir,setSortDir] = useState<'desc'|'asc'>('desc');

  const fetchData = useCallback(async(from:string,to:string)=>{
    setLoading(true); setError('');
    try{
      const res = await fetch(`/api/admin/laporan/rekap-kasir?dateFrom=${from}&dateTo=${to}`);
      const j = await res.json() as {success?:boolean;data?:RekapData;error?:string};
      if(!res.ok||!j.success){setError(j.error??'Gagal memuat data');return;}
      setData(j.data??null);
    }catch{setError('Kesalahan jaringan.');}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{fetchData(dateFrom,dateTo);},[]);// eslint-disable-line react-hooks/exhaustive-deps
  function doApply(){fetchData(dateFrom,dateTo);}
  function doReset(){const f=prevW(),t=todayW();setDateFrom(f);setDateTo(t);fetchData(f,t);}
  function toggleSort(k:typeof sortKey){if(sortKey===k)setSortDir(d=>d==='desc'?'asc':'desc');else{setSortKey(k);setSortDir('desc');}}

  const visible = data ? [...data.summary]
    .filter(k=>!searchQ||k.kasirName.toLowerCase().includes(searchQ.toLowerCase())||k.kasirNim.toLowerCase().includes(searchQ.toLowerCase()))
    .sort((a,b)=>{ const d=n(a[sortKey])-n(b[sortKey]); return sortDir==='desc'?-d:d; }) : [];

  // Grand totals — n() ensures no string concatenation
  const T = visible.reduce((a,k)=>({
    omzet:  a.omzet  + n(k.totalOmzet),
    laba:   a.laba   + n(k.totalLabaKotor),
    trx:    a.trx    + n(k.totalTxCount),
    void:   a.void   + n(k.totalVoidCount),
    shift:  a.shift  + n(k.totalShift),
    cash:   a.cash   + n(k.totalPenjualanCash ?? 0),
    qris:   a.qris   + n(k.totalPenjualanQris ?? 0),
  }),{omzet:0,laba:0,trx:0,void:0,shift:0,cash:0,qris:0});

  async function doExport(){
    if(!data?.summary.length)return;
    try{
      const EJS=(await import('exceljs')).default;
      const wb=new EJS.Workbook(); wb.creator='Smartkasir'; wb.created=new Date();
      const ws=wb.addWorksheet('Rekap Kasir');
      ws.columns=[
        {header:'Nama',key:'nama',width:26},{header:'NIM',key:'nim',width:16},{header:'Jabatan',key:'jab',width:14},
        {header:'Shift',key:'shift',width:8},{header:'Omzet (Rp)',key:'omzet',width:18},{header:'Avg/Shift (Rp)',key:'avg',width:18},
        {header:'Laba Kotor (Rp)',key:'laba',width:18},{header:'Trx',key:'trx',width:8},{header:'Void',key:'void',width:6},
        {header:'Top Produk',key:'top',width:28},{header:'Laci H',key:'sh',width:8},{header:'Laci K',key:'sk',width:8},{header:'Laci M',key:'sm',width:8},
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ws.getRow(1).eachCell((c:any)=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF166534'}};});
      ws.getRow(1).height=24;
      for(const k of data.summary){
        const r=ws.addRow({nama:k.kasirName,nim:k.kasirNim,jab:k.jabatan,shift:n(k.totalShift),
          omzet:n(k.totalOmzet),avg:n(k.avgOmzetPerShift),laba:n(k.totalLabaKotor),
          trx:n(k.totalTxCount),void:n(k.totalVoidCount),top:k.topProduk,
          sh:k.selisihLaciCount.hijau,sk:k.selisihLaciCount.kuning,sm:k.selisihLaciCount.merah});
        ['omzet','avg','laba'].forEach(c2=>{ r.getCell(c2).numFmt='"Rp "#,##0'; });
      }
      const buf=await wb.xlsx.writeBuffer();
      const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([buf])),download:`rekap-kasir-${data.dateFrom}-sd-${data.dateTo}.xlsx`});
      a.click(); URL.revokeObjectURL(a.href);
    }catch{alert('Gagal export.');}
  }

  return(
    <div>
      {/* Detail Modal */}
      {detailKasir&&data&&(
        <ShiftModal kasir={detailKasir} shifts={data.shiftDetails} onClose={()=>setDetailKasir(null)}/>
      )}

      {/* Filter */}
      <div className="card" style={{marginBottom:20,borderRadius:14}}>
        <div className="card-body" style={{padding:'14px 18px'}}>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end'}}>
            <div className="form-group" style={{margin:0}}>
              <label htmlFor={`${uid}-f`} className="form-label" style={{fontSize:'0.72rem',display:'flex',alignItems:'center',gap:4}}><Calendar size={11}/>Dari</label>
              <input id={`${uid}-f`} type="date" className="form-input" style={{fontSize:'0.82rem',padding:'6px 10px',width:140}} value={dateFrom} max={dateTo} onChange={e=>setDateFrom(e.target.value)}/>
            </div>
            <div className="form-group" style={{margin:0}}>
              <label htmlFor={`${uid}-t`} className="form-label" style={{fontSize:'0.72rem',display:'flex',alignItems:'center',gap:4}}><Calendar size={11}/>Sampai</label>
              <input id={`${uid}-t`} type="date" className="form-input" style={{fontSize:'0.82rem',padding:'6px 10px',width:140}} value={dateTo} min={dateFrom} max={todayW()} onChange={e=>setDateTo(e.target.value)}/>
            </div>
            <button id={`${uid}-ap`} onClick={doApply} disabled={loading} className="btn btn-primary btn-sm" style={{display:'flex',alignItems:'center',gap:6,padding:'7px 16px'}}>
              {loading?<Loader2 size={14} className="spin-icon"/>:<Search size={14}/>} Tampilkan
            </button>
            <button onClick={doReset} disabled={loading} className="btn btn-secondary btn-sm" style={{display:'flex',alignItems:'center',gap:6}}><RotateCcw size={13}/>Reset</button>
            <div style={{position:'relative'}}>
              <Search size={13} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'#9ca3af',pointerEvents:'none'}}/>
              <input id={`${uid}-s`} type="search" className="form-input" placeholder="Cari nama / NIM…" style={{paddingLeft:30,fontSize:'0.82rem',width:185}} value={searchQ} onChange={e=>setSearchQ(e.target.value)} aria-label="Cari kasir"/>
            </div>
            <button onClick={doExport} disabled={!data||!data.summary.length} className="btn btn-secondary btn-sm" style={{display:'flex',alignItems:'center',gap:6,marginLeft:'auto'}} aria-label="Export Excel">
              <Download size={13}/>Export Excel
            </button>
          </div>
        </div>
      </div>

      {error&&<div className="alert alert-error" role="alert" style={{marginBottom:16}}>{error}</div>}
      {loading&&(
        <div className="card" style={{borderRadius:14,marginBottom:16}}>
          <div className="card-body" style={{textAlign:'center',padding:'48px 0'}}>
            <Loader2 size={32} className="spin-icon" style={{color:'var(--color-primary)',margin:'0 auto 12px'}}/>
            <p style={{color:'var(--color-text-muted)',fontSize:'0.88rem'}}>Memuat rekap kasir…</p>
          </div>
        </div>
      )}

      {!loading&&data&&(
        <>
          {/* Stat Cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:20}}>
            {[
              {l:'Total Omzet',v:rp(T.omzet),sub:`${visible.length} kasir`,icon:<TrendingUp size={20}/>,g:'linear-gradient(135deg,#166534,#15803d)'},
              {l:'Laba Kotor',v:rp(T.laba),sub:'dari penjualan',icon:<Banknote size={20}/>,g:'linear-gradient(135deg,#0369a1,#0284c7)'},
              {l:'Total Shift',v:T.shift.toLocaleString('id-ID'),sub:`${visible.length} kasir`,icon:<Clock size={20}/>,g:'linear-gradient(135deg,#6d28d9,#7c3aed)'},
              {l:'Total Transaksi',v:T.trx.toLocaleString('id-ID'),sub:T.void>0?`${T.void} void`:'tanpa void',icon:<ShoppingBag size={20}/>,g:'linear-gradient(135deg,#b45309,#d97706)'},
              {l:'Kasir Aktif',v:String(visible.length),sub:`${data.dateFrom} s/d ${data.dateTo}`,icon:<Users size={20}/>,g:'linear-gradient(135deg,#0f766e,#14b8a6)'},
            ].map(item=>(
              <div key={item.l} style={{background:item.g,borderRadius:14,padding:'16px 18px',display:'flex',alignItems:'center',gap:14,boxShadow:'0 1px 4px rgba(0,0,0,0.1)'}}>
                <div style={{width:42,height:42,borderRadius:10,background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,color:'#fff'}}>{item.icon}</div>
                <div>
                  <div style={{fontSize:'0.7rem',color:'rgba(255,255,255,0.8)',fontWeight:500}}>{item.l}</div>
                  <div style={{fontSize:'1.1rem',fontWeight:800,color:'#fff',lineHeight:1.2}}>{item.v}</div>
                  {item.sub&&<div style={{fontSize:'0.65rem',color:'rgba(255,255,255,0.65)',marginTop:2}}>{item.sub}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Sort bar */}
          <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap',fontSize:'0.78rem',color:'var(--color-text-muted)'}}>
            <span style={{fontWeight:600}}>Urutkan:</span>
            {([['totalOmzet','Total Omzet'],['totalShift','Jumlah Shift'],['totalTxCount','Transaksi'],['avgOmzetPerShift','Rata-rata/Shift']] as [typeof sortKey,string][]).map(([k,lbl])=>{
              const act=sortKey===k;
              return(
                <button key={k} onClick={()=>toggleSort(k)} aria-pressed={act} style={{
                  padding:'4px 12px',borderRadius:999,border:`1.5px solid ${act?'#166534':'var(--color-border)'}`,
                  background:act?'#166534':'transparent',color:act?'#fff':'var(--color-text-muted)',
                  cursor:'pointer',fontSize:'inherit',display:'flex',alignItems:'center',gap:4,fontWeight:act?700:400,transition:'all 0.15s',
                }}>
                  {lbl}{act&&(sortDir==='desc'?<ChevronDown size={11}/>:<ChevronUp size={11}/>)}
                </button>
              );
            })}
          </div>

          {/* Table */}
          {visible.length===0?(
            <div className="card" style={{borderRadius:14}}>
              <div className="card-body" style={{textAlign:'center',padding:'48px 0',color:'var(--color-text-muted)'}}>
                {searchQ?`Tidak ditemukan kasir dengan kata kunci "${searchQ}".`:'Tidak ada data shift kasir pada periode ini.'}
              </div>
            </div>
          ):(
            <div className="card" style={{borderRadius:14,overflow:'hidden'}}>
              <div style={{background:'linear-gradient(90deg,#f0fdf4,#fff)',borderBottom:'1px solid var(--color-border)',padding:'12px 18px',display:'flex',alignItems:'center',gap:8}}>
                <Users size={15} style={{color:'#166534'}}/>
                <span style={{fontWeight:700,fontSize:'0.88rem',color:'#166534'}}>Kinerja Kasir</span>
                <span style={{marginLeft:4,background:'#dcfce7',color:'#166534',borderRadius:999,padding:'1px 10px',fontSize:'0.72rem',fontWeight:700}}>{visible.length} kasir</span>
              </div>
              <div className="table-wrapper">
                <table className="table" style={{fontSize:'0.78rem',whiteSpace:'nowrap'}}>
                  <thead>
                    <tr>
                      <th style={{width:28}}>#</th>
                      <th>Kasir</th><th>NIM</th>
                      <th style={{textAlign:'right'}}>Shift</th>
                      <th style={{textAlign:'right'}}>Total Omzet</th>
                      <th style={{textAlign:'right',color:'#16a34a'}}>💵 Cash</th>
                      <th style={{textAlign:'right',color:'#7c3aed'}}>📱 QRIS</th>
                      <th style={{textAlign:'right'}}>Rata-rata/Shift</th>
                      <th style={{textAlign:'right'}}>Laba Kotor</th>
                      <th style={{textAlign:'right'}}>Trx</th>
                      <th style={{textAlign:'right'}}>Void</th>
                      <th style={{textAlign:'center'}}>Selisih Laci</th>
                      <th>Top Produk</th>
                      <th style={{textAlign:'center'}}>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((k,i)=>{
                      const l=k.selisihLaciCount; const isTop=i===0; const vc=n(k.totalVoidCount);
                      return(
                        <tr key={k.kasirId} style={{background:isTop?'#f0fdf4':undefined,transition:'background 0.12s'}}>
                          <td style={{textAlign:'center',color:isTop?'#f59e0b':'#d1d5db',fontWeight:700}}>{isTop?'🏆':i+1}</td>
                          <td>
                            <div style={{fontWeight:700,color:isTop?'#166534':'inherit'}}>{k.kasirName}</div>
                            <div style={{fontSize:'0.68rem',color:'#9ca3af'}}>{k.jabatan}</div>
                          </td>
                          <td style={{color:'#6b7280',fontFamily:'monospace',fontSize:'0.73rem'}}>{k.kasirNim}</td>
                          <td style={{textAlign:'right',fontWeight:700}}>{n(k.totalShift)}</td>
                          <td style={{textAlign:'right',fontWeight:800,color:'#166534'}}>{rp(n(k.totalOmzet))}</td>
                          <td style={{textAlign:'right',fontWeight:700,color:'#16a34a'}}>{rp(n(k.totalPenjualanCash??0))}</td>
                          <td style={{textAlign:'right',fontWeight:700,color:'#7c3aed'}}>{rp(n(k.totalPenjualanQris??0))}</td>
                          <td style={{textAlign:'right',color:'#0369a1',fontWeight:600}}>{rp(n(k.avgOmzetPerShift))}</td>
                          <td style={{textAlign:'right'}}>{rp(n(k.totalLabaKotor))}</td>
                          <td style={{textAlign:'right'}}>{n(k.totalTxCount).toLocaleString('id-ID')}</td>
                          <td style={{textAlign:'right'}}>
                            {vc>0?<span style={{display:'inline-flex',alignItems:'center',gap:3,color:'#dc2626',fontWeight:700}}><AlertTriangle size={11}/>{vc}</span>:<span style={{color:'#9ca3af'}}>0</span>}
                          </td>
                          <td style={{textAlign:'center'}}>
                            <div style={{display:'flex',gap:4,justifyContent:'center',flexWrap:'wrap'}}>
                              {l.hijau>0&&<span title={`${l.hijau} shift pas`} style={{display:'inline-flex',alignItems:'center',gap:2,...TS.HIJAU,padding:'2px 7px',borderRadius:999,fontSize:'0.68rem',fontWeight:700,border:`1px solid ${TS.HIJAU.border}`}}><CheckCircle size={9}/>{l.hijau}</span>}
                              {l.kuning>0&&<span title={`${l.kuning} shift selisih kecil`} style={{...TS.KUNING,padding:'2px 7px',borderRadius:999,fontSize:'0.68rem',fontWeight:700,border:`1px solid ${TS.KUNING.border}`}}>⚠ {l.kuning}</span>}
                              {l.merah>0&&<span title={`${l.merah} shift selisih besar!`} style={{display:'inline-flex',alignItems:'center',gap:2,...TS.MERAH,padding:'2px 7px',borderRadius:999,fontSize:'0.68rem',fontWeight:700,border:`1px solid ${TS.MERAH.border}`}}><AlertTriangle size={9}/>{l.merah}</span>}
                              {l.overage>0&&<span title={`${l.overage} shift lebih`} style={{...TS.OVERAGE,padding:'2px 7px',borderRadius:999,fontSize:'0.68rem',fontWeight:700,border:`1px solid ${TS.OVERAGE.border}`}}>▲ {l.overage}</span>}
                              {(l.hijau+l.kuning+l.merah+l.overage)===0&&<span style={{color:'#d1d5db',fontSize:'0.68rem'}}>—</span>}
                            </div>
                          </td>
                          <td style={{maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',color:'#6b7280'}} title={k.topProduk}>{k.topProduk}</td>
                          <td style={{textAlign:'center'}}>
                            <button onClick={()=>setDetailKasir(k)} style={{padding:'4px 14px',borderRadius:999,border:'1.5px solid #e5e7eb',background:'transparent',color:'var(--color-text)',cursor:'pointer',fontSize:'0.73rem',fontWeight:600,transition:'all 0.15s'}}
                              onMouseEnter={e=>{e.currentTarget.style.borderColor='#166534';e.currentTarget.style.color='#166534';}}
                              onMouseLeave={e=>{e.currentTarget.style.borderColor='#e5e7eb';e.currentTarget.style.color='var(--color-text)';}}
                              aria-label={`Detail ${k.kasirName}`}>Detail</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{fontWeight:800,borderTop:'2px solid var(--color-border)',background:'#f0fdf4'}}>
                      <td/><td colSpan={2} style={{color:'#166534'}}>TOTAL ({visible.length} kasir)</td>
                      <td style={{textAlign:'right',color:'#166534'}}>{T.shift.toLocaleString('id-ID')}</td>
                      <td style={{textAlign:'right',color:'#166534'}}>{rp(T.omzet)}</td>
                      <td style={{textAlign:'right',color:'#16a34a'}}>{rp(T.cash)}</td>
                      <td style={{textAlign:'right',color:'#7c3aed'}}>{rp(T.qris)}</td>
                      <td style={{textAlign:'right',color:'#0369a1'}}>{visible.length>0?rp(T.omzet/visible.length):'—'}</td>
                      <td style={{textAlign:'right'}}>{rp(T.laba)}</td>
                      <td style={{textAlign:'right'}}>{T.trx.toLocaleString('id-ID')}</td>
                      <td style={{textAlign:'right',color:T.void>0?'#dc2626':'#9ca3af'}}>{T.void}</td>
                      <td colSpan={3}/>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Shift Detail Modal (separate to keep main component smaller)
function ShiftModal({kasir,shifts,onClose}:{kasir:KasirSummary;shifts:ShiftDetail[];onClose:()=>void}) {
  const uid=useId();
  const myS=shifts.filter(s=>s.employeeId===kasir.kasirId);
  useEffect(()=>{
    const fn=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
    document.addEventListener('keydown',fn); return()=>document.removeEventListener('keydown',fn);
  },[onClose]);
  return(
    <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.6)',backdropFilter:'blur(6px)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'24px 16px',overflowY:'auto'}}>
      <div className="card" style={{width:'100%',maxWidth:960,borderRadius:16,overflow:'hidden',animation:'slideUpFade 0.22s var(--ease-out-expo)'}}>
        <div style={{background:'linear-gradient(135deg,#1e3a5f,#1e40af)',padding:'20px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <h2 id={`${uid}-t`} style={{color:'#fff',fontSize:'1.05rem',fontWeight:700,margin:0}}>📋 Detail Shift — {kasir.kasirName}</h2>
            <p style={{color:'rgba(255,255,255,0.7)',fontSize:'0.78rem',margin:'4px 0 0'}}>NIM {kasir.kasirNim} · {kasir.jabatan} · {myS.length} shift</p>
          </div>
          <button onClick={onClose} aria-label="Tutup" style={{background:'rgba(255,255,255,0.15)',border:'none',borderRadius:8,cursor:'pointer',padding:'6px 8px',color:'#fff',display:'flex',alignItems:'center'}}><X size={18}/></button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,padding:'14px 18px',background:'var(--color-surface-alt)',borderBottom:'1px solid var(--color-border)'}}>
          {[{l:'Total Omzet',v:rp(n(kasir.totalOmzet)),c:'#166534'},{l:'Laba Kotor',v:rp(n(kasir.totalLabaKotor)),c:'#0369a1'},{l:'Rata-rata/Shift',v:rp(n(kasir.avgOmzetPerShift)),c:'#7c3aed'},{l:'Total Trx',v:n(kasir.totalTxCount).toLocaleString('id-ID'),c:'#b45309'},{l:'Top Produk',v:kasir.topProduk,c:'#0f766e'}].map(item=>(
            <div key={item.l} style={{background:'#fff',border:'1px solid var(--color-border)',borderRadius:10,padding:'10px 14px',textAlign:'center'}}>
              <div style={{fontSize:'0.68rem',color:'var(--color-text-muted)',marginBottom:3}}>{item.l}</div>
              <div style={{fontSize:'0.82rem',fontWeight:700,color:item.c,wordBreak:'break-word'}}>{item.v}</div>
            </div>
          ))}
        </div>
        <div className="table-wrapper" style={{maxHeight:'60vh',overflowY:'auto'}}>
          <table className="table" style={{fontSize:'0.75rem',whiteSpace:'nowrap'}}>
            <thead style={{position:'sticky',top:0,zIndex:2}}>
              <tr><th>Clock-In</th><th>Clock-Out</th><th>Durasi</th><th style={{textAlign:'right'}}>Omzet</th><th style={{textAlign:'right'}}>Trx</th><th style={{textAlign:'right'}}>Cash</th><th style={{textAlign:'right'}}>QRIS</th><th style={{textAlign:'right'}}>Void</th><th style={{textAlign:'right'}}>Modal</th><th style={{textAlign:'right'}}>Selisih</th><th style={{textAlign:'center'}}>Status</th></tr>
            </thead>
            <tbody>
              {myS.length===0?<tr><td colSpan={11} style={{textAlign:'center',padding:'32px 0',color:'var(--color-text-muted)'}}>Tidak ada shift</td></tr>
              :myS.map(s=>{
                const tier=s.status==='ACTIVE'?'RUNNING':s.discrepancyTier;
                const ts=TS[tier]??TS.RUNNING;
                return(
                  <tr key={s.shiftId}>
                    <td style={{fontFamily:'monospace',fontSize:'0.7rem'}}>{fdt(s.clockIn)}</td>
                    <td style={{fontFamily:'monospace',fontSize:'0.7rem',color:s.clockOut?'inherit':'#9ca3af'}}>{fdt(s.clockOut)}</td>
                    <td>{dur(s.durasiMenit)}</td>
                    <td style={{textAlign:'right',fontWeight:700,color:'#166534'}}>{rp(n(s.omzet))}</td>
                    <td style={{textAlign:'right'}}>{n(s.txCount).toLocaleString('id-ID')}</td>
                    <td style={{textAlign:'right'}}>{n(s.txCountCash)}</td>
                    <td style={{textAlign:'right'}}>{n(s.txCountQris)}</td>
                    <td style={{textAlign:'right',color:n(s.voidCount)>0?'#dc2626':'#9ca3af'}}>{n(s.voidCount)}</td>
                    <td style={{textAlign:'right',color:'#6b7280'}}>{rp(n(s.modalAwal))}</td>
                    <td style={{textAlign:'right',fontWeight:600,color:ts.color}}>
                      {s.discrepancy!==null?(s.discrepancy>=0?'+':'')+rp(n(s.discrepancy)):s.status==='ACTIVE'?'(aktif)':'—'}
                    </td>
                    <td style={{textAlign:'center'}}>
                      <span style={{display:'inline-block',padding:'2px 10px',borderRadius:999,fontSize:'0.68rem',fontWeight:700,color:ts.color,background:ts.bg,border:`1px solid ${ts.border}`}}>
                        {s.status==='ACTIVE'?'🟢 Aktif':s.statusLaci}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
