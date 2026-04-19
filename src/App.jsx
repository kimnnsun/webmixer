import { useRef, useCallback, useEffect, useState } from 'react';
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
  /**
   * [TDZ 해결을 위한 구조 개편]
   * 모든 선언(상태, Ref, 함수)을 상단에 배치하고,
   * 의존성을 가지는 useEffect 훅들은 가장 하단에 배치하여
   * ReferenceError: Cannot access 'X' before initialization (렌더링 에러)를 방어합니다.
   */

  // ── 1. 상태 및 Ref 선언 ────────────────────────────────
  const [showSpline, setShowSpline] = useState(false);
  const splineAppRef = useRef(null);

  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const audioBufferRef = useRef(null);
  const startTimeRef = useRef(0);
  const pauseOffsetRef = useRef(0);
  const isPlayingRef = useRef(false);

  const lowFilterRef = useRef(null);
  const highFilterRef = useRef(null);
  const radioFilterRef = useRef(null);

  const lowBoostOnRef = useRef(false);
  const highBoostOnRef = useRef(false);
  const radioFilterOnRef = useRef(false);

  const eqLowRef = useRef(null);
  const eqMidRef = useRef(null);
  const eqHighRef = useRef(null);

  const splineLowBtnRef = useRef(null);
  const splineMidBtnRef = useRef(null);
  const splineHighBtnRef = useRef(null);

  const spiningDiscRef = useRef(null);
  const pointLightRef = useRef(null);
  
  const lightBreathingRef = useRef(false);
  const lightFadeTweenRef = useRef(null);
  
  const rafIdRef = useRef(null);

  // ── 2. 함수 선언 (안전 가드 추가) ────────────────────────
  
  const ensureAudioContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current;

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = ctx;

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

    lowFilter.connect(highFilter);
    highFilter.connect(radioFilter);
    radioFilter.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(ctx.destination);

    return ctx;
  }, []);

  const loadAudio = useCallback(async (ctx) => {
    if (!ctx) return;
    if (audioBufferRef.current) return;
    
    try {
      const res = await fetch('/AM_Velvet.mp3');
      const arrayBuffer = await res.arrayBuffer();
      // decodeAudioData 안전 호출 (iOS 호환성 등)
      audioBufferRef.current = await ctx.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.error('❌ 오디오 파일(AM_Velvet.mp3) 로드 실패:', e);
    }
  }, []);

  const play = useCallback(async (offset = 0) => {
    try {
      const ctx = ensureAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        await ctx.resume();
        console.log('✅ 재생 버튼: AudioContext가 running 상태로 전환되었습니다.');
      }

      await loadAudio(ctx);
      if (isPlayingRef.current) return;
      if (!audioBufferRef.current) {
        console.warn('⚠️ 오디오 버퍼가 초기화되지 않았습니다.');
        return;
      }

      const src = ctx.createBufferSource();
      src.buffer = audioBufferRef.current;
      src.loop = true;
      if (lowFilterRef.current) {
        src.connect(lowFilterRef.current);
      } else {
        src.connect(ctx.destination);
      }
      src.start(0, offset);

      sourceNodeRef.current = src;
      startTimeRef.current = ctx.currentTime - offset;
      isPlayingRef.current = true;

      if (lightFadeTweenRef.current) {
        lightFadeTweenRef.current.kill();
        lightFadeTweenRef.current = null;
      }
      lightBreathingRef.current = true;

      src.onended = () => {
        isPlayingRef.current = false;
      };
      
      console.log('🎵 오디오 재생 시작');
    } catch (error) {
      console.error('❌ [오디오 재생 에러 상세 정보]:', error);
    }
  }, [ensureAudioContext, loadAudio]);

  const stop = useCallback(() => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.onended = null;
      sourceNodeRef.current.stop();
      sourceNodeRef.current = null;
    }
    pauseOffsetRef.current = 0;
    isPlayingRef.current = false;

    if (spiningDiscRef.current) {
      const currentZ = spiningDiscRef.current.rotation.z;
      const targetZ = Math.round(currentZ / (Math.PI * 2)) * (Math.PI * 2);
      gsap.to(spiningDiscRef.current.rotation, {
        z: targetZ,
        duration: 0.5,
        ease: 'power2.out',
      });
    }

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

  const resetAll = useCallback(() => {
    console.log('🔄 Reset: 전체 초기화 시작');

    if (lowFilterRef.current) lowFilterRef.current.gain.value = 0;
    if (highFilterRef.current) highFilterRef.current.gain.value = 0;
    if (radioFilterRef.current) radioFilterRef.current.type = 'allpass';

    lowBoostOnRef.current = false;
    highBoostOnRef.current = false;
    radioFilterOnRef.current = false;

    if (eqLowRef.current) eqLowRef.current.gain.value = 0;
    if (eqMidRef.current) eqMidRef.current.gain.value = 0;
    if (eqHighRef.current) eqHighRef.current.gain.value = 0;

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

    if (spiningDiscRef.current) {
      const currentZ = spiningDiscRef.current.rotation.z;
      const targetZ = Math.round(currentZ / (Math.PI * 2)) * (Math.PI * 2);
      gsap.to(spiningDiscRef.current.rotation, {
        z: targetZ,
        duration: 0.3,
        ease: 'power2.out',
      });
    }
  }, []);

  const startPollingLoop = useCallback(() => {
    const tick = () => {
      const ctx = audioContextRef.current;

      if (ctx) {
        if (splineLowBtnRef.current && eqLowRef.current) {
          const y = splineLowBtnRef.current.position.y;
          const gain = mapRange(y, Y_MIN, Y_MAX, GAIN_MIN, GAIN_MAX);
          eqLowRef.current.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
        }
        if (splineMidBtnRef.current && eqMidRef.current) {
          const y = splineMidBtnRef.current.position.y;
          const gain = mapRange(y, Y_MIN, Y_MAX, GAIN_MIN, GAIN_MAX);
          eqMidRef.current.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
        }
        if (splineHighBtnRef.current && eqHighRef.current) {
          const y = splineHighBtnRef.current.position.y;
          const gain = mapRange(y, Y_MIN, Y_MAX, GAIN_MIN, GAIN_MAX);
          eqHighRef.current.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
        }
      }

      if (spiningDiscRef.current && isPlayingRef.current) {
        spiningDiscRef.current.rotation.z -= DISC_ROTATION_SPEED;
      }

      if (pointLightRef.current && lightBreathingRef.current) {
        const mid = (LIGHT_MIN + LIGHT_MAX) / 2;
        const amp = (LIGHT_MAX - LIGHT_MIN) / 2;
        pointLightRef.current.intensity = mid + amp * Math.sin(Date.now() * LIGHT_SPEED);
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
  }, []);

  const onLoad = useCallback((spline) => {
    if (!spline) return;
    splineAppRef.current = spline;

    console.log(`🎉 Spline 씬 로드 성공! (${new Date().toLocaleTimeString()})`);

    const buttonNames = [
      'Play_Button', 'Stop_Button', 'Pause_Button',
      'LowBoost_Button', 'HighBoost_Button', 'RadioFilter_Button',
      'Reset_Button', 'Spining Disc', 'Point Light',
    ];
    let foundCount = 0;
    buttonNames.forEach((n) => {
      const obj = spline.findObjectByName(n);
      if (obj) { foundCount++; }
    });
    console.log(`   버튼 검색 결과: ${foundCount}/${buttonNames.length} 발견`);

    splineLowBtnRef.current = spline.findObjectByName('Levels-Low_Button');
    splineMidBtnRef.current = spline.findObjectByName('Levels-Mid_Button');
    splineHighBtnRef.current = spline.findObjectByName('Levels-High_Button');

    spiningDiscRef.current = spline.findObjectByName('Spining Disc');
    pointLightRef.current = spline.findObjectByName('Point Light');

    if (pointLightRef.current) {
      pointLightRef.current.intensity = 0;
    }

    startPollingLoop();
    console.log('🔄 EQ polling + Disc rotation + Light breathing started');
  }, [startPollingLoop]);

  const onError = useCallback((error) => {
    console.error('❌ Spline 씬 로드 실패!');
    console.error('   에러 메시지:', error?.message || error);
    console.error('   User Agent:', navigator.userAgent);
  }, []);

  const onSplineMouseDown = useCallback((e) => {
    const name = e.target?.name;
    if (!name) return;

    switch (name) {
      case 'Play_Button': play(pauseOffsetRef.current); break;
      case 'Stop_Button': stop(); break;
      case 'Pause_Button': pause(); break;
      case 'LowBoost_Button': toggleLowBoost(); break;
      case 'HighBoost_Button': toggleHighBoost(); break;
      case 'RadioFilter_Button': toggleRadioFilter(); break;
      case 'Reset_Button': resetAll(); break;
      default: break;
    }
  }, [play, stop, pause, toggleLowBoost, toggleHighBoost, toggleRadioFilter, resetAll]);

  // ── 3. Effects 배치는 의존성 함수들이 평가된 가장 마지막에 ──
  
  // 모바일 Retina 해상도 제한 및 마운트 지연
  useEffect(() => {
    if (window.devicePixelRatio > 2) {
      try {
        Object.defineProperty(window, 'devicePixelRatio', { get: () => 2 });
      } catch (e) {}
    }

    const timer = setTimeout(() => setShowSpline(true), 500);

    return () => {
      clearTimeout(timer);
      if (splineAppRef.current && typeof splineAppRef.current.dispose === 'function') {
        splineAppRef.current.dispose();
      }
    };
  }, []);

  // 모바일 오디오 활성화를 위한 초기 클릭 감지
  useEffect(() => {
    const handleFirstInteraction = async () => {
      try {
        const ctx = ensureAudioContext();
        if (ctx && ctx.state === 'suspended') {
          await ctx.resume();
          console.log('🔓 [Init] 첫 터치/클릭 감지: AudioContext 상태 해제 (running)');
        }
      } catch (err) {
        console.error('⚠️ [Init] AudioContext 초기 활성화 실패:', err);
      } finally {
        window.removeEventListener('pointerdown', handleFirstInteraction);
        window.removeEventListener('touchstart', handleFirstInteraction);
      }
    };

    window.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    window.addEventListener('touchstart', handleFirstInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };
  }, [ensureAudioContext]);

  // rAF 루프 정리
  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // ── 4. 렌더링 ──────────────────────────────────────────
  return (
    <div className="app-container">
      {/* ── 3D Canvas: 화면 전체를 덮는 Spline 씬 ── */}
      <div className="spline-canvas">
        {showSpline && (
          <Spline
            scene="/scene.splinecode?v=1"
            style={{ width: '100%', height: '100%' }}
            onLoad={onLoad}
            onError={onError}
            onSplineMouseDown={onSplineMouseDown}
            renderOnDemand={true}
            hint="performance"
          />
        )}
      </div>

      {/* ── UI Overlay: 피그마 디자인을 입힐 레이어 ── */}
      <div className="ui-overlay">
        {/* 여기에 피그마 UI 요소를 추가하세요 */}
      </div>
    </div>
  );
}
