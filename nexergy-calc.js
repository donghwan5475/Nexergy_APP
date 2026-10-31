/* =====================================================================
   Nexergy 계산 파일 v0.1  —  nexergy_engine.py(열저항망 엔진)를 브라우저용 JS로 옮긴 것
   =====================================================================
   업체 UI(app.js)가 정한 연결 규칙:
     window.NexergyCalc = { name, core: function (p) { return {...}; } }

   들어오는 p (app.js의 params()가 만들어 줌)
     fluid {label, short, T, latent}   유체. short = 'LH2' | 'LN2' | 'LNG'
     Ta °C, pressure barg, hours h/년, price 원/kg, rec % (0~100)
     segs [{name, tag, L m, D m(내관 외경), mat, it mm, ood mm, ot mm}]
           it/ood/ot 는 app.js params()에 한 줄 추가해야 들어옴. 없으면 아래 FALLBACK 사용
     method 'mli' | 'vac' | 'foam',  N MLI 층수,  P 진공도 Pa
     foamT m(폼 두께), foamK W/m·K
     supMat 'G10'|'PTFE'|'SUS304'|..., spacing m, supArea mm², supLen mm, supKint W/m
     parts [{type, qty, w}]

   돌려주는 값 (app.js CALC_REQ가 요구하는 12개 + 화면용 보조값)
     Q W, perM W/m, bogDay kg/일, bogYr kg/년, loss 원/년
     Qp 부품, Qr 복사, Qs 지지대, Qg 잔류가스, Qf 폼   (각 W)
     segs [{name, tag, L, rad, gas, sup, foam, nsup, Q, Tj}],  parts [{type, qty, w, Q}]
     p    입력 사본인데 Tf·latent를 운전압력 기준 포화온도·잠열로 바꿔 넣음 (화면 표기용)
     dT   외기 − 유체 포화온도 (K)

   모델 (파이썬 엔진 docstring과 동일)
     외기 ─[1/hA]─ 외관 ─┬─ 복사 (MLI: σ(Tj⁴−Tw⁴)·A·D·ε/((N+1)(2−ε)),  진공만: 동심원통 회색체)
                         ├─ 잔류가스 (자유분자 Corruccini ↔ 연속체, 조화평균)
                         └─ 지지대 (n × ∫k(T)dT × A/L, NIST 적합식)
                         + 부품 (개당 W × 수량)
     폼 단열: 2πLΔT / (ln(r_o/r_i)/k + 1/(h·r_o)),  진공·지지대 없음
     BOG = Q × 운전시간 / 증발잠열,   손실 = BOG × 단가 × (1 − 회수율)

   주의: 설계 검토용 추정치. 제조사 사양과 실측으로 확인할 것.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- 1. 팀이 확정해야 하는 가정값 (파이썬 Insulation/Operating 기본값과 동일) ---------- */
  var CFG = {
    H_EXTERNAL: 10.0,         // 외관 바깥 자연대류+복사 등가 열전달계수 W/m²K
    EMISSIVITY_MLI: 0.03,     // 알루미늄 증착 필름 방사율
    EMISSIVITY_PIPE: 0.10,    // 스테인리스 표면 방사율 (진공만일 때 내관 외면·외관 내면)
    MLI_DEGRADATION: 3.0,     // MLI 열화계수 D (실측 문헌 2~5)
    MLI_LAYER_PITCH_MM: 0.5,  // MLI 층 간격 (연속체 가스전도 두께 계산용)
    ACCOMMODATION: 0.9,       // 열적응계수 α
    GAS_MOLAR_MASS: 0.029,    // 잔류가스 몰질량 kg/mol (공기)
    GAS_GAMMA: 1.4,           // 비열비
    T_GAUGE_K: 300.0,         // 진공계 기준 온도 (실온)
    JACKET_ITER: 4,           // 외관 온도 반복 횟수
    KINT_STEPS: 200,          // ∫k dT 사다리꼴 분할 수
    REF_DT_CUSTOM: 278,       // supKint(재질 미등록 시) 기준 온도차 K — app.js CFG.REF_DT와 같음
    FALLBACK_ANNULUS_MM: 25,  // 외관 치수가 안 넘어올 때: 내관 외면 ~ 외관 내면 간격
    FALLBACK_OUTER_WT_MM: 3   // 외관 두께
  };
  var SIGMA = 5.670374419e-8, R_GAS = 8.314462618;

  /* ---------- 2. 유체 물성 — NIST 몇 점 보간 (파이썬 _TSAT/_HFG 그대로) ---------- */
  var TSAT = {   // [절대압 bar, 포화온도 K]
    LH2: [[1.013, 20.3], [2.0, 22.8], [3.0, 24.6], [5.0, 27.1], [8.0, 29.9], [10.0, 31.4]],
    LN2: [[1.013, 77.4], [2.0, 84.0], [3.0, 88.0], [5.0, 94.0], [8.0, 100.4], [10.0, 103.7]],
    LNG: [[1.013, 111.7], [2.0, 120.6], [3.0, 126.5], [5.0, 134.7], [8.0, 143.6], [10.0, 149.1]]
  };
  var HFG = {    // [포화온도 K, 증발잠열 kJ/kg]
    LH2: [[20.3, 446.0], [23.0, 430.0], [25.0, 412.0], [27.0, 390.0], [30.0, 335.0], [32.0, 260.0]],
    LN2: [[77.4, 199.0], [85.0, 187.0], [95.0, 170.0], [105.0, 150.0]],
    LNG: [[111.7, 510.0], [120.0, 495.0], [135.0, 465.0], [150.0, 425.0]]
  };
  function interp(x, pts, logx) {
    var xs = pts.map(function (q) { return logx ? Math.log(q[0]) : q[0]; });
    var ys = pts.map(function (q) { return q[1]; });
    if (logx) x = Math.log(x);
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    for (var i = 0; i < xs.length - 1; i++) {
      if (xs[i] <= x && x <= xs[i + 1]) {
        var t = (x - xs[i]) / (xs[i + 1] - xs[i]);
        return ys[i] + t * (ys[i + 1] - ys[i]);
      }
    }
    return ys[ys.length - 1];
  }
  function saturationTemperature(fluid, pBarg) { return interp(pBarg + 1.013, TSAT[fluid], true); }  // K
  function latentHeat(fluid, tSat) { return interp(tSat, HFG[fluid], false) * 1000.0; }               // J/kg

  /* ---------- 3. 고체 열전도도 — NIST 극저온 물성 적합식 log10 k = Σ a_i (log10 T)^i ---------- */
  var NIST = {
    G10:   [-4.1236, 13.788, -26.068, 26.272, -14.663, 4.4954, -0.6905, 0.0397, 0.0],
    PTFE:  [2.7380, -30.677, 89.430, -136.99, 124.69, -69.556, 23.320, -4.3135, 0.33829],
    SS304: [-1.4087, 1.3982, 0.2543, -0.6260, 0.2334, 0.4256, -0.4658, 0.1650, -0.0199]
  };
  var SUPMAT_ALIAS = { G10: 'G10', 'G-10': 'G10', PTFE: 'PTFE', SUS304: 'SS304', SS304: 'SS304', SUS316: 'SS304', SUS316L: 'SS304', SS316: 'SS304' };
  function conductivity(mat, T) {
    var c = NIST[mat];
    T = Math.min(Math.max(T, 4.0), 300.0);
    var lt = Math.log10(T), s = 0, pw = 1;
    for (var i = 0; i < c.length; i++) { s += c[i] * pw; pw *= lt; }
    return Math.pow(10, s);
  }
  function conductivityIntegral(mat, tCold, tHot) {  // ∫k dT [W/m], 사다리꼴
    var n = CFG.KINT_STEPS, h = (tHot - tCold) / n;
    var s = 0.5 * (conductivity(mat, tCold) + conductivity(mat, tHot));
    for (var i = 1; i < n; i++) s += conductivity(mat, tCold + i * h);
    return s * h;
  }
  function gasConductivityAir(T) { return 0.0241 * Math.pow(T / 273.15, 0.9); }

  /* ---------- 4. 표기 도우미 (app.js와 같은 3유효숫자 반올림: 화면 숫자끼리 맞추기 위함) ---------- */
  function sig3v(v) {
    if (!isFinite(v) || v === 0) return v;
    var m = Math.pow(10, 3 - (Math.floor(Math.log10(Math.abs(v))) + 1));
    return Math.round(v * m) / m;
  }
  function round1(v) { return Math.round(v * 10) / 10; }

  /* ---------- 5. 구간 1개의 열유입 (파이썬 _segment_heat) ---------- */
  function segmentHeat(s, p, tCold, tAmb) {
    var L = s.L, foam = p.method === 'foam', mli = p.method === 'mli';
    var r_i = s.D / 2;                                   // 내관 외반경 m
    var r_jin, r_jout;
    if (isFinite(s.ood) && s.ood > 0) {
      var ot = (isFinite(s.ot) && s.ot > 0) ? s.ot : CFG.FALLBACK_OUTER_WT_MM;
      r_jin = (s.ood / 2 - ot) / 1000; r_jout = s.ood / 2000;
    } else {
      r_jin = r_i + CFG.FALLBACK_ANNULUS_MM / 1000; r_jout = r_jin + CFG.FALLBACK_OUTER_WT_MM / 1000;
    }
    if (!(r_jin > r_i)) r_jin = r_i * 1.5;               // 입력이 이상해도 계산은 멈추지 않게
    var A_i = 2 * Math.PI * r_i * L, A_jin = 2 * Math.PI * r_jin * L, A_out = 2 * Math.PI * r_jout * L;

    var nSup = (!foam && p.spacing > 0) ? Math.max(1, Math.floor(L / p.spacing + 1e-9)) : 0;
    var supMat = SUPMAT_ALIAS[String(p.supMat || '').toUpperCase()] || null;
    var P = p.P, N = p.N;

    var tHot = tAmb, qRad = 0, qGas = 0, qSup = 0, qFoam = 0, qIns = 0;
    for (var it = 0; it < CFG.JACKET_ITER; it++) {
      var dT = tHot - tCold;
      qRad = qGas = qSup = qFoam = 0;
      if (foam) {
        var r_f = r_i + p.foamT;
        var R_foam = Math.log(r_f / r_i) / (2 * Math.PI * p.foamK * L);
        var R_ext_f = 1.0 / (CFG.H_EXTERNAL * 2 * Math.PI * r_f * L);
        qFoam = (tAmb - tCold) / (R_foam + R_ext_f);
        tHot = tAmb - qFoam * R_ext_f;                   // 폼 표면 온도
        qIns = qFoam;
      } else {
        var nGaps;
        /* (a) 복사 */
        if (mli) {
          var e = CFG.EMISSIVITY_MLI;
          var epsEff = CFG.MLI_DEGRADATION * e / ((N + 1) * (2.0 - e));
          qRad = SIGMA * A_i * (Math.pow(tHot, 4) - Math.pow(tCold, 4)) * epsEff;
          nGaps = N + 1;
        } else {
          var ei = CFG.EMISSIVITY_PIPE, eo = CFG.EMISSIVITY_PIPE;
          var denom = 1.0 / ei + (A_i / A_jin) * (1.0 / eo - 1.0);
          qRad = SIGMA * A_i * (Math.pow(tHot, 4) - Math.pow(tCold, 4)) / denom;
          nGaps = 1;
        }
        /* (b) 잔류가스 전도: 자유분자(Corruccini) ↔ 연속체, 조화평균 */
        var g = CFG.GAS_GAMMA;
        var Lam = (g + 1) / (g - 1) * Math.sqrt(R_GAS / (8 * Math.PI * CFG.GAS_MOLAR_MASS * CFG.T_GAUGE_K));
        var qFm = (P > 0) ? CFG.ACCOMMODATION * Lam * P * A_i * dT / nGaps : 0;
        var kG = gasConductivityAir(0.5 * (tHot + tCold)), qC;
        if (mli) { var tBl = Math.max(N * CFG.MLI_LAYER_PITCH_MM / 1000, 1e-4); qC = kG * A_i * dT / tBl; }
        else qC = 2 * Math.PI * kG * L * dT / Math.log(r_jin / r_i);
        qGas = qFm <= 0 ? 0 : 1.0 / (1.0 / qFm + 1.0 / qC);
        /* (c) 지지대 전도 */
        if (nSup > 0) {
          var kint = supMat ? conductivityIntegral(supMat, tCold, tHot)
                            : (isFinite(p.supKint) ? p.supKint * dT / CFG.REF_DT_CUSTOM : 0);
          qSup = nSup * kint * (p.supArea * 1e-6) / (p.supLen * 1e-3);
        }
        qIns = qRad + qGas + qSup;
        tHot = tAmb - qIns / (CFG.H_EXTERNAL * A_out);  // 외관 온도 갱신
      }
    }
    return { name: s.name, tag: s.tag, L: L, rad: qRad, gas: qGas, sup: qSup, foam: qFoam, nsup: nSup,
             Q: qIns, perM: qIns / L, Tj: tHot };
  }

  /* ---------- 6. 전체 계산 — UI가 부르는 함수 ---------- */
  function core(p) {
    var fluidKey = p.fluid && TSAT[p.fluid.short] ? p.fluid.short : null;
    var tCold, hfg;
    if (fluidKey) { tCold = saturationTemperature(fluidKey, isFinite(p.pressure) ? p.pressure : 0); hfg = latentHeat(fluidKey, tCold); }
    else { tCold = p.Tf + 273.15; hfg = p.latent * 1000; }     // 모르는 유체면 화면 표 값 그대로
    var tAmb = p.Ta + 273.15, dT = tAmb - tCold;

    var segs = p.segs.map(function (s) { return segmentHeat(s, p, tCold, tAmb); });
    var parts = p.parts.map(function (x) { return { type: x.type, qty: x.qty, w: x.w, Q: x.qty * x.w }; });
    function sum(a, k) { return a.reduce(function (t, x) { return t + (x[k] || 0); }, 0); }

    var Qp = sum(parts, 'Q'), Qr = sum(segs, 'rad'), Qg = sum(segs, 'gas'), Qs = sum(segs, 'sup'), Qf = sum(segs, 'foam');
    var Q = Qp + Qr + Qg + Qs + Qf;
    var L = sum(segs, 'L'), nsup = sum(segs, 'nsup'), partQty = sum(parts, 'qty');
    var bogYr = Q * p.hours * 3600 / hfg;                  // kg/년
    var bogDay = Q * 86400 / hfg;                           // kg/일 (연중무휴 환산)
    var lossExact = bogYr * p.price * (1 - p.rec / 100);
    var loss = sig3v(bogYr) * p.price * (1 - p.rec / 100);  // 화면 숫자(3유효숫자 BOG × 단가)와 맞춤

    /* 화면에 '유체 온도·잠열'로 찍히는 값을 운전압력 기준으로 바꿔 넣음 */
    var pOut = Object.assign({}, p, { Tf: round1(tCold - 273.15), latent: round1(hfg / 1000) });

    return {
      p: pOut, dT: dT, segs: segs, parts: parts, L: L, nsup: nsup, partQty: partQty,
      Q: Q, perM: L > 0 ? Q / L : 0, bogYr: bogYr, bogDay: bogDay, loss: loss, lossExact: lossExact,
      Qp: Qp, Qr: Qr, Qg: Qg, Qs: Qs, Qf: Qf,
      cond: { fluid: fluidKey || (p.fluid && p.fluid.short), pressureBarg: p.pressure, tSatK: tCold, hfgKJkg: hfg / 1000, tAmbK: tAmb },
      network: {   // 열저항망 그림용 등가 저항 K/W (ΔT ÷ 경로별 W)
        radiation: Qr > 1e-12 ? dT / Qr : null, residualGas: Qg > 1e-12 ? dT / Qg : null,
        support: Qs > 1e-12 ? dT / Qs : null, foam: Qf > 1e-12 ? dT / Qf : null, parts: Qp > 1e-12 ? dT / Qp : null,
        total: Q > 0 ? dT / Q : null
      }
    };
  }

  window.NexergyCalc = {
    name: 'Nexergy 계산 v0.1',
    version: '0.1.0',
    core: core,
    config: CFG,
    /* 검증·디버그용 내부 함수 */
    _engine: { saturationTemperature: saturationTemperature, latentHeat: latentHeat, conductivity: conductivity,
               conductivityIntegral: conductivityIntegral, segmentHeat: segmentHeat, sig3v: sig3v }
  };
})();
