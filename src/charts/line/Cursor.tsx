import * as React from 'react';

import Animated, {
  runOnJS,
  useAnimatedGestureHandler,
} from 'react-native-reanimated';
import {
  GestureEvent,
  LongPressGestureHandler,
  LongPressGestureHandlerEventPayload,
  LongPressGestureHandlerProps,
} from 'react-native-gesture-handler';

import { LineChartDimensionsContext } from './Chart';
import { StyleSheet } from 'react-native';
import { bisectCenter } from 'd3-array';
import { scaleLinear } from 'd3-scale';
import { useLineChart } from './useLineChart';
import type { Path } from 'react-native-redash';

export type LineChartCursorProps = LongPressGestureHandlerProps & {
  children: React.ReactNode;
  type: 'line' | 'crosshair';
  // Does not work on web due to how the Cursor operates on web
  snapToPoint?: boolean;
  timestamps: number[];
};

export const CursorContext = React.createContext({ type: '' });

function findClosestIndex(timestamps, xRelative) {
  let left = 0;
  let right = timestamps.length - 1;

  // Handle edge cases where xRelative is outside the timestamps range
  if (xRelative <= timestamps[left]) {
    return left;
  }
  if (xRelative >= timestamps[right]) {
    return right;
  }

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);

    if (timestamps[mid] === xRelative) {
      return mid; // Exact match found
    }

    if (timestamps[mid] < xRelative) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  // At this point, left points to the index after the closest lower value
  // and right points to the index before the closest higher value
  // We need to determine which one is closer to xRelative
  const leftDiff = Math.abs(timestamps[left] - xRelative);
  const rightDiff = Math.abs(timestamps[right] - xRelative);

  if (leftDiff <= rightDiff) {
    return left;
  } else {
    return right;
  }
}

LineChartCursor.displayName = 'LineChartCursor';

export function LineChartCursor({
  children,
  snapToPoint,
  type,
  timestamps,
  ...props
}: LineChartCursorProps) {
  const { pathWidth: width, parsedPath } = React.useContext(
    LineChartDimensionsContext
  );
  const { currentX, currentIndex, isActive, data, xDomain } = useLineChart();
  const xValues = React.useMemo(
    () => data.map(({ timestamp }, i) => (xDomain ? timestamp : i)),
    [data, xDomain]
  );

  // Same scale as in /src/charts/line/utils/getPath.ts
  const scaleX = React.useMemo(() => {
    const domainArray = xDomain ?? [0, xValues.length];
    return scaleLinear().domain(domainArray).range([0, width]);
  }, [width, xDomain, xValues.length]);

  const linearScalePositionAndIndex = ({
    timestamps,
    width,
    xPosition,
    path,
    xDomain,
  }: {
    timestamps: number[];
    width: number;
    xPosition: number;
    path: Path | undefined;
    xDomain: [number, number] | undefined;
  }) => {
    if (!path) {
      return;
    }
  
    const domainArray = xDomain ?? [0, timestamps.length];
  
    // Same scale as in /src/charts/line/utils/getPath.ts
    const scaleX = scaleLinear().domain(domainArray).range([0, width]);
  
    // Calculate a scaled timestamp for the current touch position
    const xRelative = scaleX.invert(xPosition);
  
  
    // const closestIndex = bisectCenter(timestamps, xRelative);
    const closestIndex = findClosestIndex(timestamps, xRelative);
  
    const pathDataDelta = Math.abs(path.curves.length - timestamps.length); // sometimes there is a difference between data length and number of path curves.
    const closestPathCurve = Math.max(
      Math.min(closestIndex, path.curves.length + 1) -
        pathDataDelta,
      0
    );
    const p0 = (closestIndex > 0 ? path.curves[closestPathCurve].to : path.move)
      .x;
    // Update values
    currentIndex.value = closestIndex;
    // currentX.value = p0;
    
  };

  const onGestureEvent = useAnimatedGestureHandler<
    GestureEvent<LongPressGestureHandlerEventPayload>
  >({
    
    onActive: ({ x }) => {
      if (parsedPath) {
        const xPosition = Math.max(0, x <= width ? x : width);
        isActive.value = true;

        const xValues = data.map(({ timestamp }, i) =>
          xDomain ? timestamp : i
        );

        // on Web, we could drag the cursor to be negative, breaking it
        // so we clamp the index at 0 to fix it
        // https://github.com/coinjar/react-native-wagmi-charts/issues/24
        const minIndex = 0;
        const boundedIndex = Math.max(
          minIndex,
          Math.round(xPosition / width / (1 / (data.length - 1)))
        );


        if (snapToPoint) {
          // We have to run this on the JS thread unfortunately as the scaleLinear functions won't work on UI thread
          runOnJS(linearScalePositionAndIndex)({
            timestamps: xValues,
            width,
            xPosition: xPosition,
            path: parsedPath,
            xDomain,
          });
          currentX.value = xPosition;
          // update the currentX and currentIndex values
        } else if (!snapToPoint) {
          currentX.value = xPosition;
          currentIndex.value = boundedIndex;
        }
      }
    },
    onEnd: () => {
      isActive.value = false;
      currentIndex.value = -1;
    },
  });

  return (
    <CursorContext.Provider value={{ type }}>
      <LongPressGestureHandler
        minDurationMs={0}
        maxDist={999999}
        onGestureEvent={onGestureEvent}
        shouldCancelWhenOutside={false}
        {...props}
      >
        <Animated.View style={StyleSheet.absoluteFill}>
          {children}
        </Animated.View>
      </LongPressGestureHandler>
    </CursorContext.Provider>
  );
}
