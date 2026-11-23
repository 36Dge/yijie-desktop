import { BarChart, LineChart, PieChart, RadarChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent, GridComponent, LegendComponent, MarkAreaComponent,
  MarkLineComponent, RadarComponent, TitleComponent, TooltipComponent,
} from "echarts/components";
import { use } from "echarts/core";
import { LabelLayout } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";

use([
  BarChart, LineChart, PieChart, RadarChart, ScatterChart,
  AriaComponent, GridComponent, LegendComponent, MarkAreaComponent,
  MarkLineComponent, RadarComponent, TitleComponent, TooltipComponent,
  LabelLayout, SVGRenderer,
]);

export { init } from "echarts/core";
