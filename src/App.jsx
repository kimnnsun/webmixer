import { useRef, useCallback, useEffect } from 'react';
import Spline from '@splinetool/react-spline';
import gsap from 'gsap';

// ── 유틸리티: 선형 매핑 함수 ────────────────────────────
// Spline Y 범위 [-120, 110] → Gain 범위 [-20, 20]
const Y_MIN = -120;
const Y_MAX = 110;
const GAIN_MIN = -20;
const GAIN_MAX = 20;

// EQ 레벨 버튼의 초기 Y 위치 (중앙 기준점)
const EQ_BUTTON_INITIAL_Y = 0;

// Spining Disc 회전 속도 (라디안/프레임)
const DISC_ROTATION_SPEED = 0.02;

// Point Light 숨쉬는 조명 설정
const LIGHT_MIN = 1.0;
const LIGHT_MAX = 2.44;
const LIGHT_SPEED = 0.0015; // 사인파 속도 (느릴수록 느림, ~4초 주기)

function mapRange(value, inMin, inMax, outMin, outMax) {
  const clamped = Math.max(inMin, Math.min(inMax, value));
  return outMin + ((clamped - inMin) / (inMax - inMin)) * (outMax - outMin);
}

export default function App() {
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const audioBufferRef = useRef(null);
  const startTimeRef = useRef(0);
  const pauseOffsetRef = useRef(0);
  const isPlayingRef = useRef(false);

  // ── 이펙트 필터 Refs ──────────────────────────────────
  const lowFilterRef = useRef(null);
  const highFilterRef = useRef(null);
  const radioFilterRef = useRef(null);

  // ── 이펙트 토글 상태 Refs ─────────────────────────────
  const lowBoostOnRef = useRef(false);
  const highBoostOnRef = useRef(false);
  const radioFilterOnRef = useRef(false);

  // ── 3-Band EQ 필터 Refs ───────────────────────────────
  const eqLowRef = useRef(null);
  const eqMidRef = useRef(null);
  const eqHighRef = useRef(null);

  // ── Spline 3D 메시 객체 Refs (위치 폴링용) ────────────
  const splineLowBtnRef = useRef(null);
  const splineMidBtnRef = useRef(null);
  const splineHighBtnRef = useRef(null);

  // ── Spining Disc Ref ──────────────────────────────────
  const spiningDiscRef = useRef(null);

  // ── Point Light Ref + 상태 ────────────────────────────
  const pointLightRef = useRef(null);
  const lightBreathingRef = useRef(false); // 숨쉬는 애니메이션 활성 여부
  const lightFadeTweenRef = useRef(null);  // gsap tween 참조 (충돌 방지)

  // ── rAF ID Ref (cleanup용) ────────────────────────────
  const rafIdRef = useRef(null);

  // ── AudioContext + 필터 체인 초기화 ───────────────────
  const ensureAudioContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current;

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = ctx;

    // === 이펙트 필터 ===
    const lowFilter = ctx.createBiquadFilter();
    lowFilter.type = 'lowshelf';
    lowFilter.frequency.value = 320;
    lowFilter.gain.value = 0;
    lowFilterRef.current = lowFilter;

    const highFilter = ctx.createBiquadFilter();
    highFilter.type = 'highshelf';
    highFilter.frequency.value = 3200;
    highFilter.gain.value = 0;
    highFilterRef.current = highFilter;

    const radioFilter = ctx.createBiquadFilter();
    radioFilter.type = 'allpass';
    radioFilter.frequency.value = 2000;
    radioFilter.Q.value = 5;
    radioFilterRef.current = radioFilter;

    // === 3-Band EQ ===
    const eqLow = ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 200;
    eqLow.gain.value = 0;
    eqLowRef.current = eqLow;

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 1.5;
    eqMid.gain.value = 0;
    eqMidRef.current = eqMid;

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 4000;
    eqHigh.gain.value = 0;
    eqHighRef.current = eqHigh;

    // 직렬 연결:
    // Source -> LowFilter -> HighFilter -> RadioFilter -> EQ Low -> EQ Mid -> EQ High -> Destination
    lowFilter.connect(highFilter);
    highFilter.connect(radioFilter);
    radioFilter.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(ctx.destination);

    return ctx;
  }, []);

  // ── 오디오 버퍼 로드 ─────────────────────────────────
  const loadAudio = useCallback(async (ctx) => {
    if (audioBufferRef.current) return;
    const res = await fetch('/AM_Velvet.mp3');
    const arrayBuffer = await res.arrayBuffer();
    audioBufferRef.current = await ctx.decodeAudioData(arrayBuffer);
  }, []);

  // ── 재생 (offset 위치부터) ────────────────────────────
  const play = useCallback(async (offset = 0) => {
    const ctx = ensureAudioContext();

    if (ctx.state === 'suspended') await ctx.resume();
    await loadAudio(ctx);
    if (isPlayingRef.current) return;

    const src = ctx.createBufferSource();
    src.buffer = audioBufferRef.current;
    src.loop = true;
    src.connect(lowFilterRef.current);
    src.start(0, offset);

    sourceNodeRef.current = src;
    startTimeRef.current = ctx.currentTime - offset;
    isPlayingRef.current = true;

    // 조명 숨쉬기 활성화 (페이드아웃 중이었다면 중단)
    if (lightFadeTweenRef.current) {
      lightFadeTweenRef.current.kill();
      lightFadeTweenRef.current = null;
    }
    lightBreathingRef.current = true;

    src.onended = () => {
      isPlayingRef.current = false;
    };
  }, [ensureAudioContext, loadAudio]);

  // ── 정지 ─────────────────────────────────────────────
  const stop = useCallback(() => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.onended = null;
      sourceNodeRef.current.stop();
      sourceNodeRef.current = null;
    }
    pauseOffsetRef.current = 0;
    isPlayingRef.current = false;

    // 디스크 회전을 가장 가까운 2π 배수로 부드럽게 스냅
    if (spiningDiscRef.current) {
      const currentZ = spiningDiscRef.current.rotation.z;
      const targetZ = Math.round(currentZ / (Math.PI * 2)) * (Math.PI * 2);
      gsap.to(spiningDiscRef.current.rotation, {
        z: targetZ,
        duration: 0.5,
        ease: 'power2.out',
      });
    }

    // 조명 숨쉬기 중지 + 페이드 아웃
    lightBreathingRef.current = false;
    if (pointLightRef.current) {
      if (lightFadeTweenRef.current) lightFadeTweenRef.current.kill();
      lightFadeTweenRef.current = gsap.to(pointLightRef.current, {
        intensity: 0,
        duration: 0.5,
        ease: 'power2.out',
        onComplete: () => { lightFadeTweenRef.current = null; },
      });
    }
  }, []);

  // ── 일시정지 ─────────────────────────────────────────
  const pause = useCallback(() => {
    if (!isPlayingRef.current) return;
    const ctx = audioContextRef.current;
    if (!ctx) return;

    const elapsed = ctx.currentTime - startTimeRef.current;
    const duration = audioBufferRef.current?.duration || 1;
    pauseOffsetRef.current = elapsed % duration;

    if (sourceNodeRef.current) {
      sourceNodeRef.current.onended = null;
      sourceNodeRef.current.stop();
      sourceNodeRef.current = null;
    }
    isPlayingRef.current = false;
  }, []);

  // ── 이펙트 토글 ──────────────────────────────────────
  const toggleLowBoost = useCallback(() => {
    if (!lowFilterRef.current) return;
    lowBoostOnRef.current = !lowBoostOnRef.current;
    lowFilterRef.current.gain.value = lowBoostOnRef.current ? 15 : 0;
    console.log(`🔊 LowBoost: ${lowBoostOnRef.current ? 'ON' : 'OFF'}`);
  }, []);

  const toggleHighBoost = useCallback(() => {
    if (!highFilterRef.current) return;
    highBoostOnRef.current = !highBoostOnRef.current;
    highFilterRef.current.gain.value = highBoostOnRef.current ? 15 : 0;
    console.log(`🔊 HighBoost: ${highBoostOnRef.current ? 'ON' : 'OFF'}`);
  }, []);

  const toggleRadioFilter = useCallback(() => {
    if (!radioFilterRef.current) return;
    radioFilterOnRef.current = !radioFilterOnRef.current;
    radioFilterRef.current.type = radioFilterOnRef.current ? 'bandpass' : 'allpass';
    console.log(`📻 RadioFilter: ${radioFilterOnRef.current ? 'ON' : 'OFF'}`);
  }, []);

  // ── 전체 초기화 (Reset) ───────────────────────────────
  const resetAll = useCallback(() => {
    console.log('🔄 Reset: 전체 초기화 시작');

    // 1) 이펙트 필터 초기화
    if (lowFilterRef.current) {
      lowFilterRef.current.gain.value = 0;
    }
    if (highFilterRef.current) {
      highFilterRef.current.gain.value = 0;
    }
    if (radioFilterRef.current) {
      radioFilterRef.current.type = 'allpass';
    }

    // 토글 상태 Ref 초기화
    lowBoostOnRef.current = false;
    highBoostOnRef.current = false;
    radioFilterOnRef.current = false;

    // 2) 3-Band EQ gain 즉시 0으로
    if (eqLowRef.current) eqLowRef.current.gain.value = 0;
    if (eqMidRef.current) eqMidRef.current.gain.value = 0;
    if (eqHighRef.current) eqHighRef.current.gain.value = 0;

    // 3) Spline 메시 위치를 gsap으로 부드럽게 복귀
    const buttons = [
      splineLowBtnRef.current,
      splineMidBtnRef.current,
      splineHighBtnRef.current,
    ];

    buttons.forEach((btn) => {
      if (!btn) return;
      gsap.to(btn.position, {
        y: EQ_BUTTON_INITIAL_Y,
        duration: 0.3,
        ease: 'power2.out',
      });
    });

    // 4) Spining Disc 회전을 가장 가까운 2π 배수로 스냅
    if (spiningDiscRef.current) {
      const currentZ = spiningDiscRef.current.rotation.z;
      const targetZ = Math.round(currentZ / (Math.PI * 2)) * (Math.PI * 2);
      gsap.to(spiningDiscRef.current.rotation, {
        z: targetZ,
        duration: 0.3,
        ease: 'power2.out',
      });
    }

    console.log('✅ Reset: 모든 이펙트, EQ, 메시 위치, 디스크 회전 초기화 완료');
  }, []);

  // ── rAF 폴링 루프: EQ 위치 + 디스크 회전 ──────────────
  const startPollingLoop = useCallback(() => {
    const tick = () => {
      const ctx = audioContextRef.current;

      // ── EQ 폴링 ──
      // Low 버튼
      if (splineLowBtnRef.current && eqLowRef.current && ctx) {
        const y = splineLowBtnRef.current.position.y;
        const gain = mapRange(y, Y_MIN, Y_MAX, GAIN_MIN, GAIN_MAX);
        eqLowRef.current.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
      }

      // Mid 버튼
      if (splineMidBtnRef.current && eqMidRef.current && ctx) {
        const y = splineMidBtnRef.current.position.y;
        const gain = mapRange(y, Y_MIN, Y_MAX, GAIN_MIN, GAIN_MAX);
        eqMidRef.current.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
      }

      // High 버튼
      if (splineHighBtnRef.current && eqHighRef.current && ctx) {
        const y = splineHighBtnRef.current.position.y;
        const gain = mapRange(y, Y_MIN, Y_MAX, GAIN_MIN, GAIN_MAX);
        eqHighRef.current.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
      }

      // ── Spining Disc 회전 (재생 중일 때만) ──
      if (spiningDiscRef.current && isPlayingRef.current) {
        spiningDiscRef.current.rotation.z -= DISC_ROTATION_SPEED;
      }

      // ── Point Light 숨쉬는 조명 (Play 또는 Pause 상태) ──
      if (pointLightRef.current && lightBreathingRef.current) {
        const mid = (LIGHT_MIN + LIGHT_MAX) / 2;   // 1.72
        const amp = (LIGHT_MAX - LIGHT_MIN) / 2;    // 0.72
        pointLightRef.current.intensity = mid + amp * Math.sin(Date.now() * LIGHT_SPEED);
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
  }, []);

  // ── cleanup: 컴포넌트 언마운트 시 rAF 정리 ────────────
  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // ── Spline 씬 로드 완료 콜백 ─────────────────────────
  const onLoad = useCallback((spline) => {
    console.log(`🎉 Spline 씬 로드 성공! (${new Date().toLocaleTimeString()})`);
    console.log(`   Scene URL: /scene.splinecode`);

    // 일반 버튼 확인 로그
    const buttonNames = [
      'Play_Button', 'Stop_Button', 'Pause_Button',
      'LowBoost_Button', 'HighBoost_Button', 'RadioFilter_Button',
      'Reset_Button', 'Spining Disc', 'Point Light',
    ];
    let foundCount = 0;
    buttonNames.forEach((n) => {
      const obj = spline.findObjectByName(n);
      if (obj) { console.log(`✅ ${n} found`); foundCount++; }
      else console.warn(`⚠️ ${n} not found`);
    });
    console.log(`   버튼 검색 결과: ${foundCount}/${buttonNames.length} 발견`);

    // EQ 레벨 버튼 객체 참조 저장
    const lowBtn = spline.findObjectByName('Levels-Low_Button');
    const midBtn = spline.findObjectByName('Levels-Mid_Button');
    const highBtn = spline.findObjectByName('Levels-High_Button');

    splineLowBtnRef.current = lowBtn;
    splineMidBtnRef.current = midBtn;
    splineHighBtnRef.current = highBtn;

    if (lowBtn) console.log(`✅ Levels-Low_Button found (Y: ${lowBtn.position.y.toFixed(1)})`);
    else console.warn('⚠️ Levels-Low_Button not found');

    if (midBtn) console.log(`✅ Levels-Mid_Button found (Y: ${midBtn.position.y.toFixed(1)})`);
    else console.warn('⚠️ Levels-Mid_Button not found');

    if (highBtn) console.log(`✅ Levels-High_Button found (Y: ${highBtn.position.y.toFixed(1)})`);
    else console.warn('⚠️ Levels-High_Button not found');

    // Spining Disc 객체 참조 저장
    const disc = spline.findObjectByName('Spining Disc');
    spiningDiscRef.current = disc;
    if (disc) console.log(`✅ Spining Disc found (rotation.z: ${disc.rotation.z.toFixed(2)})`);
    else console.warn('⚠️ Spining Disc not found');

    // Point Light 객체 참조 저장 + 초기 intensity 0
    const light = spline.findObjectByName('Point Light');
    pointLightRef.current = light;
    if (light) {
      light.intensity = 0;
      console.log('✅ Point Light found (intensity set to 0)');
    } else {
      console.warn('⚠️ Point Light not found');
    }

    // 폴링 루프 시작
    startPollingLoop();
    console.log('🔄 EQ polling + Disc rotation + Light breathing started');
  }, [startPollingLoop]);

  // ── Spline 씬 로드 에러 콜백 ──────────────────────────
  const onError = useCallback((error) => {
    console.error('❌ Spline 씬 로드 실패!');
    console.error('   에러 메시지:', error?.message || error);
    console.error('   에러 객체:', error);
    console.error('   Scene URL: /scene.splinecode');
    console.error('   User Agent:', navigator.userAgent);
    console.error('   시간:', new Date().toLocaleTimeString());
    console.error('   ─── 확인 사항 ───');
    console.error('   1. public/scene.splinecode 파일이 존재하는지 확인');
    console.error('   2. 네트워크 탭에서 해당 파일의 HTTP 상태 코드 확인');
    console.error('   3. 파일이 손상되지 않았는지 확인 (Spline에서 다시 추출)');
  }, []);

  // ── Spline 마우스다운(클릭) 이벤트 ───────────────────
  const onSplineMouseDown = useCallback(
    (e) => {
      const name = e.target?.name;
      if (!name) return;

      console.log('🖱️ Spline Clicked:', name);

      switch (name) {
        // 재생 컨트롤
        case 'Play_Button':
          play(pauseOffsetRef.current);
          break;
        case 'Stop_Button':
          stop();
          break;
        case 'Pause_Button':
          pause();
          break;

        // 이펙트 토글
        case 'LowBoost_Button':
          toggleLowBoost();
          break;
        case 'HighBoost_Button':
          toggleHighBoost();
          break;
        case 'RadioFilter_Button':
          toggleRadioFilter();
          break;

        // 전체 초기화
        case 'Reset_Button':
          resetAll();
          break;

        default:
          break;
      }
    },
    [play, stop, pause, toggleLowBoost, toggleHighBoost, toggleRadioFilter, resetAll],
  );

  return (
    <div className="app-container">
      {/* ── 3D Canvas: 화면 전체를 덮는 Spline 씬 ── */}
      <div className="spline-canvas">
        <Spline
          scene="/scene.splinecode?v=1"
          style={{ width: '100%', height: '100%' }}
          onLoad={onLoad}
          onError={onError}
          onSplineMouseDown={onSplineMouseDown}
        />
      </div>

      {/* ── UI Overlay: 피그마 디자인을 입힐 레이어 ── */}
      {/* pointer-events: none → 3D 클릭 투과                */}
      {/* .clickable 요소에만 pointer-events: auto 적용       */}
      <div className="ui-overlay">
        {/* 여기에 피그마 UI 요소를 추가하세요 */}
        {/* 예시:
          <button className="clickable" style={{ position: 'absolute', top: 20, left: 20 }}>
            Menu
          </button>
        */}
      </div>
    </div>
  );
}
