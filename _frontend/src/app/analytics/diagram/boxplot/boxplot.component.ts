import {AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {DataService} from "../../../_services/data.service";
import {Driver, EventData} from "../../../_services/api.service";
import {Subject, take, takeUntil} from "rxjs";
import {Account} from "../../../settings/settings.component";
import {readableStreamLikeToAsyncGenerator} from "rxjs/internal/util/isReadableStreamLike";

@Component({
  selector: 'app-boxplot',
  templateUrl: './boxplot.component.html',
  styleUrls: ['./boxplot.component.scss']
})

export class BoxplotComponent implements AfterViewInit, OnInit, OnDestroy {

  @ViewChild('canvas') canvas: ElementRef<HTMLCanvasElement>
  @ViewChild('canvasAxis') canvasAxis: ElementRef<HTMLCanvasElement>
  @ViewChild('svgTime') svgTime: ElementRef<SVGElement>
  @ViewChild('svgName') svgName: ElementRef<SVGElement>
  @ViewChild('labelDetail') labelDetail: ElementRef<HTMLDivElement>
  @ViewChild('labelDetailTime') labelDetailTime: ElementRef<HTMLDivElement>
  @ViewChild('labelDetailLap') labelDetailLap: ElementRef<HTMLDivElement>
  label_scale = "1.0"
  labelDetailTime_content: string
  labelDetailLap_content: string
  _showLabelDetail: boolean = false
  _showLabelDetail_lapNr: boolean = false
  private stop$ = new Subject<void>()
  private context: CanvasRenderingContext2D | any
  private contextAxis: CanvasRenderingContext2D | any
  private appWidth: number
  private appHeight: number

  private cust_id: number
  private data_live: BoxplotElement[]
  private data_original: EventData = new EventData()
  private data: EventData = new EventData()
  private bpprop: BoxplotProperties
  private diaprop: DiagramProperties = new DiagramProperties()
  private highlightedDriver: Driver | null
  private highlightedDetailType: DetailType

  private scale: xy = {x: 1, y: 1}
  private scaleFactor = 0.1
  private scrollX = 0
  private scrollY = 0
  private isDown: boolean
  private startX: number
  private startY: number
  private cameraOffset: xy = {x: 0, y: 0}
  private highlightedLap: number

  constructor(private app: ElementRef, private dataService: DataService) {
  }

  ngOnInit() {
    // user-id
    this.dataService.mainAcc.pipe(takeUntil(this.stop$)).subscribe(acc => this.cust_id = acc?.custId!)

    // new bpprop
    this.dataService.boxplotProperties.pipe(takeUntil(this.stop$)).subscribe(bpprop => {
      this.bpprop = bpprop
      this.updateDiagram()
    })

    // new data
    this.dataService.analyticsData.pipe(takeUntil(this.stop$)).subscribe(data => {
      this.data_original = data
      this.updateDiagram()
    })
  }

  ngOnDestroy() {
    this.stop$.next()
    this.stop$.complete()
  }

  ngAfterViewInit() {

    // first init when view loads
    this.canvas.nativeElement.width = this.appWidth = this.app.nativeElement.parentNode.clientWidth - 150 // 1390
    this.canvas.nativeElement.height = this.appHeight = this.app.nativeElement.parentNode.clientHeight // 786
    this.context = this.canvas.nativeElement.getContext('2d')
    this.contextAxis = this.canvasAxis.nativeElement.getContext('2d')
    this.initBpprop()
    this.initDiaprop()
    this.canvasAxis.nativeElement.width = this.diaprop.yAxisBgWidth
    this.canvasAxis.nativeElement.height = this.appHeight
    this.initSVGs()
    this.drawSVG_Y_laptimeLabels()
    this.drawSVG_X_driverLabels()
    this.draw()
  }

  @HostListener('wheel', ['$event'])
  mousewheel(event: WheelEvent) {
    if (event.ctrlKey) {
      // this.scaleCanvasVertically(event)
    } else {
      this.scaleCanvas(event)
      this.drawSVG_Y_laptimeLabels()
      this.drawSVG_X_driverLabels()
    }
  }

  @HostListener('mouseup', ['$event'])
  mouseUp(event: MouseEvent) {
    this.handleMouseUp(event)
  }

  @HostListener('mousedown', ['$event'])
  mouseDown(event: MouseEvent) {
    this.handleMouseDown(event)
  }

  @HostListener('mouseout', ['$event'])
  mouseOut(event: MouseEvent) {
    this.handleMouseOut(event)
  }

  @HostListener('mousemove', ['$event'])
  mouseMove(event: MouseEvent) {
    this.detectHover(event)
    this.handleMouseMove(event)
  }

  private draw() {

    this.clearCanvas()

    this.drawBackground()
    this.drawBoxplot()
    this.drawAxes()
    this.drawDetailLabels()

    requestAnimationFrame(this.draw.bind(this))

  }

  private drawAxes() {

    // y-axis
    this.contextAxis.beginPath()
    this.contextAxis.moveTo(this.diaprop.yAxis_pos / this.scale.x, this.diaprop.renderStart.y)
    this.contextAxis.lineTo(this.diaprop.yAxis_pos / this.scale.x, this.diaprop.renderEnd.y / this.scale.y)
    this.contextAxis.strokeStyle = this.diaprop.yAxis_color
    this.contextAxis.lineWidth = 1 / this.scale.x
    this.contextAxis.stroke()

    // full ticks
    for (let i = 0; i < this.diaprop.yAxisTicks_end; i++) {

      this.contextAxis.beginPath()
      this.contextAxis.strokeStyle = this.diaprop.yAxis_color
      this.contextAxis.moveTo((this.diaprop.yAxis_pos - this.diaprop.fullTick_width / 2) / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
      this.contextAxis.lineTo((this.diaprop.yAxis_pos + this.diaprop.fullTick_width / 2) / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
      this.contextAxis.stroke()

      this.contextAxis.beginPath()
      this.contextAxis.strokeStyle = this.diaprop.fullTick_color
      this.contextAxis.moveTo((this.diaprop.yAxis_pos + this.diaprop.fullTick_width / 2) / this.scale.x, (this.convertSecondsToPixels(i)) - this.scrollY)
      this.contextAxis.lineTo((this.diaprop.yAxisBgWidth / this.scale.x), (this.convertSecondsToPixels(i)) - this.scrollY)
      this.contextAxis.stroke()
    }

    // 1/2 ticks
    if (this.scale.x > 1.0) {
      for (let i = 0.5; i < this.diaprop.yAxisTicks_end; i++) {
        this.contextAxis.beginPath()
        this.contextAxis.strokeStyle = this.diaprop.yAxis_color
        this.contextAxis.moveTo((this.diaprop.yAxis_pos - this.diaprop.halfTick_width / 2) / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
        this.contextAxis.lineTo((this.diaprop.yAxis_pos + this.diaprop.halfTick_width / 2) / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
        this.contextAxis.stroke()

        this.contextAxis.beginPath()
        this.contextAxis.strokeStyle = this.diaprop.halfTick_color
        this.contextAxis.moveTo((this.diaprop.yAxis_pos + this.diaprop.halfTick_width / 2) / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
        this.contextAxis.lineTo(this.diaprop.yAxisBgWidth / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
        this.contextAxis.stroke()
      }
    }

    // 1/4 ticks
    if (this.scale.x > 2.0) {
      for (let i = 0.25; i < this.diaprop.yAxisTicks_end;) {
        this.contextAxis.beginPath()
        this.contextAxis.strokeStyle = this.diaprop.yAxis_color
        this.contextAxis.moveTo((this.diaprop.yAxis_pos - this.diaprop.quarterTick_width / 2) / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
        this.contextAxis.lineTo((this.diaprop.yAxis_pos + this.diaprop.quarterTick_width / 2) / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
        this.contextAxis.stroke()

        this.contextAxis.beginPath()
        this.contextAxis.strokeStyle = this.diaprop.quarterTick_color
        this.contextAxis.moveTo((this.diaprop.yAxis_pos + this.diaprop.quarterTick_width / 2) / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
        this.contextAxis.lineTo(this.diaprop.yAxisBgWidth / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
        this.contextAxis.stroke()

        i = i + 0.5
      }
    }
  }

  private drawBackground() {

    this.context.beginPath()
    this.context.lineWidth = 1 / this.scale.x
    this.context.strokeStyle = this.diaprop.fullTick_color

    //this.numberOfLabelsToDraw()

    // full seconds
    for (let i = 0; i < this.diaprop.yAxisTicks_end; i++) {
      this.context.moveTo(0 - this.cameraOffset.x / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
      this.context.lineTo((this.context.canvas.width - this.cameraOffset.x) / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
    }

    this.context.stroke()

    // 1/2 seconds
    if (this.scale.x > 1.0) {

      this.context.beginPath()
      this.context.strokeStyle = this.diaprop.halfTick_color

      for (let i = 0.5; i < this.diaprop.yAxisTicks_end; i++) {
        this.context.moveTo(0 - this.cameraOffset.x / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
        this.context.lineTo((this.context.canvas.width - this.cameraOffset.x) / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
      }
      this.context.stroke()
    }

    // 1/4 seconds
    if (this.scale.x > 2.0) {

      this.context.beginPath()
      this.context.strokeStyle = this.diaprop.quarterTick_color

      for (let i = 0.25; i < this.diaprop.yAxisTicks_end;) {
        this.context.moveTo(0 - this.cameraOffset.x / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)
        this.context.lineTo((this.context.canvas.width - this.cameraOffset.x) / this.scale.x, this.convertSecondsToPixels(i) - this.scrollY)

        i = i + 0.5
      }
      this.context.stroke()
    }
  }

  private drawBoxplot() {

    this.data_live = new Array<BoxplotElement>()
    this.calculateBoxplotWidth()

    for (const [i, driver] of this.data.drivers.entries()) {

      if (driver.laps.length > 0) {

        let bpelement = new BoxplotElement()
        this.bpprop.carclass1.bp.prop.location = this.bpprop.carclass1.bp.prop.gap + i * (this.bpprop.carclass1.bp.prop.width + this.bpprop.carclass1.bp.prop.gap)
        this.bpprop.carclass1.bp.prop.middle = this.bpprop.carclass1.bp.prop.location + (this.bpprop.carclass1.bp.prop.width / 2)

        // original values (laptimes)
        let median = driver.bpdata.median
        let mean = driver.bpdata.mean
        let q1 = driver.bpdata.Q1
        let q3 = driver.bpdata.Q3
        let whisker_top = driver.bpdata.whisker_top
        let whisker_bottom = driver.bpdata.whisker_bottom
        let fliers_top = driver.bpdata.fliers_top
        let fliers_bottom = driver.bpdata.fliers_bottom

        // calculated values (pixels)
        bpelement.whiskers = this.drawWhiskers(q1, whisker_bottom, q3, whisker_top, driver)
        bpelement.Q1 = this.drawBox(q1, q3, driver).Q1
        bpelement.Q3 = this.drawBox(q1, q3, driver).Q3
        bpelement.median = this.drawMedian(median, driver)
        bpelement.fliers = this.drawFliers(fliers_top, fliers_bottom)
        bpelement.driver = driver

        let subOption_indLaps = this.bpprop.options['showIndividualLaps'].suboptions!

        // if (this.bpprop.options['showIndividualLaps'].checked) {
        //   bpelement.laps = this.drawLaps(driver)
        // }

        if (this.bpprop.options['showMean'].checked) {
          bpelement.mean = this.drawMean(mean, driver)
        }

        this.data_live.push(bpelement)
      }
    }
  }

  private drawBox(q1: number, q3: number, driver: Driver) {

    this.setColor_Box(driver)

    let q3_x_start = this.bpprop.carclass1.bp.prop.location - this.scrollX
    let q3_x_end = (this.bpprop.carclass1.bp.prop.location + this.bpprop.carclass1.bp.prop.width) - this.scrollX
    let q3_y = this.convertSecondsToPixels(q3) - this.scrollY

    let q1_x_start = this.bpprop.carclass1.bp.prop.location - this.scrollX
    let q1_x_end = (this.bpprop.carclass1.bp.prop.location + this.bpprop.carclass1.bp.prop.width) - this.scrollX
    let q1_y = this.convertSecondsToPixels(q1) - this.scrollY

    let height = this.convertSecondsToPixels(q3) - this.convertSecondsToPixels(q1)

    this.context.fillRect(q1_x_start, q1_y, this.bpprop.carclass1.bp.prop.width, height)

    //top
    this.context.beginPath()

    if (this.driverSelected(driver) && this.dataTypeHighlighted(DetailType.Q3)) {
      this.context.lineWidth = this.bpprop.carclass1.q3.prop.lineThickness_SELECT / this.scale.x
    } else {
      this.context.lineWidth = this.bpprop.carclass1.q3.prop.lineThickness_DEFAULT / this.scale.x
    }

    this.context.moveTo(q3_x_start, q3_y)
    this.context.lineTo(q3_x_start + this.bpprop.carclass1.bp.prop.width, q3_y)
    this.context.stroke()

    //right
    this.context.beginPath()
    this.context.lineWidth = this.bpprop.carclass1.q3.prop.lineThickness_DEFAULT / this.scale.x
    this.context.moveTo(q1_x_start + this.bpprop.carclass1.bp.prop.width, q1_y)
    this.context.lineTo(q1_x_start + this.bpprop.carclass1.bp.prop.width, q3_y)
    this.context.stroke()

    //bottom
    this.context.beginPath()
    if (this.driverSelected(driver) && this.dataTypeHighlighted(DetailType.Q1)) {
      this.context.lineWidth = this.bpprop.carclass1.q1.prop.lineThickness_SELECT / this.scale.x
    } else {
      this.context.lineWidth = this.bpprop.carclass1.q1.prop.lineThickness_DEFAULT / this.scale.x
    }
    this.context.moveTo(q1_x_start, q1_y)
    this.context.lineTo(q1_x_start + this.bpprop.carclass1.bp.prop.width, q1_y)
    this.context.stroke()

    //left
    this.context.beginPath()
    this.context.lineWidth = this.bpprop.carclass1.q1.prop.lineThickness_DEFAULT  / this.scale.x
    this.context.moveTo(q1_x_start, q1_y)
    this.context.lineTo(q1_x_start, q3_y)
    this.context.stroke()

    return {
      Q1: {
        x: {
          start: q1_x_start,
          end: q1_x_end
        },
        y: q1_y
      },

      Q3: {
        x: {
          start: q3_x_start,
          end: q3_x_end
        },
        y: q3_y
      }
    }
  }

  private drawMedian(median: number, driver: Driver) {

    this.setColor_Median(driver)

    let median_x_start = this.bpprop.carclass1.bp.prop.location - this.scrollX
    let median_x_end = this.bpprop.carclass1.bp.prop.location + this.bpprop.carclass1.median.prop.width - this.scrollX
    let median_y = this.convertSecondsToPixels(median) - this.scrollY

    this.context.beginPath()

    if (this.driverSelected(driver) && this.dataTypeHighlighted(DetailType.MEDIAN)) {
      this.context.lineWidth = (this.bpprop.carclass1.median.prop.lineThickness_SELECT) / this.scale.x
      this.context.moveTo(median_x_start, median_y)
      this.context.lineTo(median_x_end, median_y)
    } else {
      this.context.lineWidth = this.bpprop.carclass1.median.prop.lineThickness_DEFAULT / this.scale.x
      this.context.moveTo(median_x_start, median_y)
      this.context.lineTo(median_x_end, median_y)
    }

    this.context.stroke()

    return {
      x: {
        start: median_x_start,
        end: median_x_end
      },
      y: median_y
    }
  }

  private drawMean(mean: number, driver: Driver) {

    this.setColor_Mean()

    let mean_x = this.bpprop.carclass1.bp.prop.middle - this.scrollX
    let mean_y = this.convertSecondsToPixels(mean) - this.scrollY

    this.context.beginPath()

    if (this.driverSelected(driver) && this.dataTypeHighlighted(DetailType.MEAN)) {
      this.context.arc(mean_x, mean_y, this.bpprop.carclass1.mean.prop.radius_SELECT, 0, (Math.PI / 180) * 360)
    } else {
      this.context.arc(mean_x, mean_y, this.bpprop.carclass1.mean.prop.radius_DEFAULT, 0, (Math.PI / 180) * 360)
    }

    this.context.fill()

    return {
      x: mean_x,
      y: mean_y
    }
  }

  private drawWhiskers(q1: number, whisker_bottom: number, q3: number, whisker_top: number, driver: Driver) {

    this.setColor_Whiskers(driver)

    //line to whisker top
    this.context.beginPath()
    this.context.lineWidth = this.bpprop.carclass1.whiskers.prop.lineThickness_DEFAULT / this.scale.x
    this.context.moveTo(this.bpprop.carclass1.bp.prop.middle - this.scrollX, this.convertSecondsToPixels(q3) - this.scrollY)
    this.context.lineTo(this.bpprop.carclass1.bp.prop.middle - this.scrollX, this.convertSecondsToPixels(whisker_top) - this.scrollY)
    this.context.stroke()

    // whisker top
    let top_x_start = this.bpprop.carclass1.bp.prop.middle - this.bpprop.carclass1.whiskers.prop.width / 2 - this.scrollX
    let top_x_end = this.bpprop.carclass1.bp.prop.middle + this.bpprop.carclass1.whiskers.prop.width / 2 - this.scrollX
    let top_y = this.convertSecondsToPixels(whisker_top) - this.scrollY

    // on-hover (whisker top)
    this.context.beginPath()

    if (this.driverSelected(driver) && this.dataTypeHighlighted(DetailType.WHISKER_TOP)) {
      this.context.lineWidth = (this.bpprop.carclass1.whiskers.prop.lineThickness_SELECT) / this.scale.x
      this.context.moveTo(top_x_start, top_y)
      this.context.lineTo(top_x_end, top_y)
    } else {
      this.context.lineWidth = this.bpprop.carclass1.whiskers.prop.lineThickness_DEFAULT / this.scale.x
      this.context.moveTo(top_x_start, top_y)
      this.context.lineTo(top_x_end, top_y)
    }
    this.context.stroke()

    //line to whisker bottom
    this.context.beginPath()
    this.context.lineWidth = this.bpprop.carclass1.whiskers.prop.lineThickness_DEFAULT / this.scale.x
    this.context.moveTo(this.bpprop.carclass1.bp.prop.middle - this.scrollX, this.convertSecondsToPixels(q1) - this.scrollY)
    this.context.lineTo(this.bpprop.carclass1.bp.prop.middle - this.scrollX, this.convertSecondsToPixels(whisker_bottom) - this.scrollY)
    this.context.stroke()

    // whisker bottom
    let bottom_x_start = this.bpprop.carclass1.bp.prop.middle - this.bpprop.carclass1.whiskers.prop.width / 2 - this.scrollX
    let bottom_x_end = this.bpprop.carclass1.bp.prop.middle + this.bpprop.carclass1.whiskers.prop.width / 2 - this.scrollX
    let bottom_y = this.convertSecondsToPixels(whisker_bottom) - this.scrollY

    this.context.beginPath()

    // on-hover (whisker bottom)
    if (this.driverSelected(driver) && this.dataTypeHighlighted(DetailType.WHISKER_BOTTOM)) {

      this.context.lineWidth = (this.bpprop.carclass1.whiskers.prop.lineThickness_SELECT) / this.scale.x
      this.context.moveTo(bottom_x_start, bottom_y)
      this.context.lineTo(bottom_x_end, bottom_y)

    } else {
      this.context.lineWidth = this.bpprop.carclass1.whiskers.prop.lineThickness_DEFAULT / this.scale.x
      this.context.moveTo(bottom_x_start, bottom_y)
      this.context.lineTo(bottom_x_end, bottom_y)
    }
    this.context.stroke()

    return {
      top: {
        x: {
          start: top_x_start,
          end: top_x_end
        },
        y: top_y
      },
      bottom: {
        x: {
          start: bottom_x_start,
          end: bottom_x_end
        },
        y: bottom_y
      }
    }
  }

  private drawFliers(fliers_top: Array<number>, fliers_bottom: Array<number>) {

    this.setColor_Fliers()

    let fliersArray_top: Array<Fliers> = []
    let fliersArray_bottom: Array<Fliers> = []

    fliers_top.forEach(flier => {

      let flier_x = this.bpprop.carclass1.bp.prop.middle - this.scrollX
      let flier_y = this.convertSecondsToPixels(flier) - this.scrollY

      this.context.beginPath()
      this.context.lineWidth = this.bpprop.carclass1.fliers.lineThickness
      this.context.arc(flier_x, flier_y, this.bpprop.carclass1.fliers.radius, 0, (Math.PI / 180) * 360)
      this.context.stroke()

      fliersArray_top.push({x: flier_x, y: flier_y})

    })

    fliers_bottom.forEach(flier => {

      let flier_x = this.bpprop.carclass1.bp.prop.middle - this.scrollX
      let flier_y = this.convertSecondsToPixels(flier) - this.scrollY

      this.context.beginPath()
      this.context.lineWidth = this.bpprop.carclass1.fliers.lineThickness
      this.context.arc(flier_x, flier_y, this.bpprop.carclass1.fliers.radius, 0, (Math.PI / 180) * 360)
      this.context.stroke()

      fliersArray_bottom.push({x: flier_x, y: flier_y})

    })
    return {top: fliersArray_top, bottom: fliersArray_bottom}
  }

  private drawLaps(driver: Driver, subOption?: { [p: string]: { label: string; checked: boolean } }) {

    let lapsArray: Array<Lap> = []
    let lapXY: Lap

    if (subOption != undefined) {
      if (subOption["showIncidents"].checked) {
        this.drawLaps_Incident(driver, bpoption.showIncidents)
      }
    }

    this.drawLaps_All(driver, lapsArray)

    return lapsArray
  }

  private drawSVG_Y_laptimeLabels() {

    let gContainer = this.init_gContainer("gContainerTime", this.svgTime);

    let x = this.diaprop.tickLabel_x

    // omit every 2nd tick
    if (this.scale.x < 0.7) {
      for (let i = 0; i < this.diaprop.yAxisTicks_end;) {

        let y = (this.convertSecondsToPixels(i) - this.scrollY) * this.scale.x + 9.5 + this.cameraOffset.y

        if (0 < y && y < this.appHeight) {

          let element = document.createElementNS('http://www.w3.org/2000/svg', 'text');

          let time = this.convertTimeFormat(i)

          element.setAttribute("x", x.toString())
          element.setAttribute("y", y.toString())
          element.setAttribute("fill", this.diaprop.fullTickLabel_fontColor)
          element.setAttribute("transform", "scale(1.1)")
          element.style.transformBox = "fill-box"
          element.style.transformOrigin = "right 50%"
          element.setAttribute("font-size", this.diaprop.fullTickLabel_fontSize + "px")
          element.setAttribute("text-rendering", "geometricPrecision")
          element.textContent = time

          gContainer.append(element)
        }

        i = i + 2

      }
    }

    // full ticks
    if (this.scale.x >= 0.7) {
      for (let i = 0; i < this.diaprop.yAxisTicks_end; i++) {

        let y = (this.convertSecondsToPixels(i) - this.scrollY) * this.scale.x + 9.5 + this.cameraOffset.y

        if (0 < y && y < this.appHeight) {

          let element = document.createElementNS('http://www.w3.org/2000/svg', 'text');

          let time = this.convertTimeFormat(i)

          element.setAttribute("x", x.toString())
          element.setAttribute("y", y.toString())
          element.setAttribute("fill", this.diaprop.fullTickLabel_fontColor)
          element.setAttribute("transform", "scale(1.1)")
          element.style.transformBox = "fill-box"
          element.style.transformOrigin = "right 50%"
          element.setAttribute("font-size", this.diaprop.fullTickLabel_fontSize + "px")
          element.setAttribute("text-rendering", "geometricPrecision")
          element.textContent = time

          gContainer.append(element)
        }
      }
    }

    // 1/2 ticks
    if (this.scale.x > 2.0) {
      for (let i = 0.5; i < this.diaprop.yAxisTicks_end; i++) {

        let y = (this.convertSecondsToPixels(i) - this.scrollY) * this.scale.x + 9.5 + this.cameraOffset.y

        if (0 < y && y < this.appHeight) {

          let element = document.createElementNS('http://www.w3.org/2000/svg', 'text');

          let time = this.convertTimeFormat(i)

          element.setAttribute("x", x.toString())
          element.setAttribute("y", y.toString())
          element.setAttribute("fill", this.diaprop.halfTickLabel_fontColor)
          element.setAttribute("transform", "scale(1.1)")
          element.style.transformBox = "fill-box"
          element.style.transformOrigin = "right 50%"
          element.setAttribute("font-size", this.diaprop.halfTickLabel_fontSize + "px")
          element.setAttribute("text-rendering", "geometricPrecision")
          element.textContent = time

          gContainer.append(element)
        }

      }
    }
  }

  private drawSVG_X_driverLabels() {

    let gContainer = this.init_gContainer("gContainerName", this.svgName);

    for (const [i, driver] of this.data.drivers.entries()) {

      let x_pos = this.calc_xPosition(i);

      let textElement_name = this.drawSVG_X_driverLabels_name(x_pos, driver);
      gContainer.append(textElement_name)

      let textElement_finishPosition = this.drawSVG_X_driverLabels_finishPosition(x_pos, driver);
      gContainer.append(textElement_finishPosition)

    }
  }

  private init_gContainer(name: string, svgElement: ElementRef<SVGElement>) {

    let temp = document.getElementById(name)

    if (temp) {
      temp.remove()
    }

    let gContainer = document.createElementNS("http://www.w3.org/2000/svg", "g")
    gContainer.setAttribute("id", name)
    svgElement.nativeElement.append(gContainer)

    return gContainer;
  }

  private calc_xPosition(i: number) {

    let bp_width = this.bpprop.carclass1.bp.prop.width

    while (this.canvas.nativeElement.width < this.bpprop.carclass1.bp.prop.gap + (this.data.drivers.length) * (bp_width + this.bpprop.carclass1.bp.prop.gap)) {
      bp_width = bp_width - 0.1
    }

    let bp_location = this.diaprop.yAxisBgWidth + this.bpprop.carclass1.bp.prop.gap + i * (bp_width + this.bpprop.carclass1.bp.prop.gap)
    let bp_middle = (bp_location + (bp_width / 2) - this.scrollX) * this.scale.x

    return bp_middle + 130 + this.cameraOffset.x;
  }

  private drawSVG_X_driverLabels_name(x_pos: number, driver: Driver) {

    let driver_name = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    let y_pos = this.diaprop.drivernameLabel_y

    driver_name.setAttribute("x", x_pos.toString())
    driver_name.setAttribute("y", y_pos.toString())
    driver_name.setAttribute("fill", this.diaprop.drivernameLabel_fontColor)
    driver_name.setAttribute("transform", "rotate(300)")
    driver_name.style.transformBox = "fill-box"
    driver_name.style.transformOrigin = "right 50%"
    driver_name.setAttribute("text-anchor", "end")
    driver_name.setAttribute("font-size", this.diaprop.drivernameLabel_fontSize + "px")
    driver_name.setAttribute("text-rendering", "geometricPrecision")
    driver_name.textContent = driver.name

    if (driver.name == this.diaprop.userDriver.name) {
      driver_name.setAttribute("font-weight", "bold")
      driver_name.setAttribute("fill", "white")
    }

    return driver_name
  }

  private drawSVG_X_driverLabels_finishPosition(x_pos: number, driver: Driver) {

    let driver_finishPosition = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    let y_pos = this.diaprop.driverPositionLabel_y

    driver_finishPosition.setAttribute("x", x_pos.toString())
    driver_finishPosition.setAttribute("y", y_pos.toString())
    driver_finishPosition.setAttribute("fill", this.diaprop.driverPositionLabel_fontColor)
    driver_finishPosition.style.transformBox = "fill-box"
    driver_finishPosition.style.transformOrigin = "center 50%"
    driver_finishPosition.setAttribute("text-anchor", "middle")
    driver_finishPosition.setAttribute("font-size", this.diaprop.driverPositionLabel_fontSize + "px")
    driver_finishPosition.setAttribute("text-rendering", "geometricPrecision")

    if (this.bpprop.options["showMulticlass"].checked) {
      driver_finishPosition.textContent = driver.finish_position.toString()
    } else {
      driver_finishPosition.textContent = driver.finish_position_in_class.toString()
    }

    if (driver.name == this.diaprop.userDriver.name) {
      driver_finishPosition.setAttribute("font-weight", "bold")
      driver_finishPosition.setAttribute("fill", "white")
    }

    return driver_finishPosition
  }

  private convertSecondsToPixels(seconds: number) {
    return Math.round(this.diaprop.lineafunction_m * seconds + this.diaprop.linearfunction_t) + 0.5
  }

  private convertTimeFormat(time: number) {

    let minutes = (Math.floor(time / 60))
    let seconds = (time - minutes * 60)

    if (seconds < 10) {
      return minutes.toString() + ":" + "0" + seconds.toFixed(3)
    } else {
      return minutes.toString() + ":" + seconds.toFixed(3)
    }
  }

  private calculateBoxplotWidth() {

    // use carclass1 boxplot width (=200px) and subtract -0.1 from it until the array of boxplots (incl gaps between) fits into the canvas
    while (this.canvas.nativeElement.width < this.bpprop.carclass1.bp.prop.gap + this.data.drivers.length * (this.bpprop.carclass1.bp.prop.width + this.bpprop.carclass1.bp.prop.gap)) {
      this.bpprop.carclass1.bp.prop.width = this.bpprop.carclass1.bp.prop.width - 0.1
    }

    // set median and whisker width accordingly
    this.bpprop.carclass1.median.prop.width = this.bpprop.carclass1.bp.prop.width
    this.bpprop.carclass1.whiskers.prop.width = this.bpprop.carclass1.bp.prop.width * 0.6
  }

  private detectHover(event: MouseEvent) {

    // detects, if mouse hovers over a specific element

    let x_mouse = (event.offsetX - this.cameraOffset.x) / this.scale.x
    let y_mouse = (event.offsetY - this.cameraOffset.y) / this.scale.y

    this.highlightedDriver = null

    outerloop:
      for (let i = this.data_live.length - 1, element; element = this.data_live[i]; i--) {

        let laps = element.laps
        let mean = element.mean
        let median = element.median
        let whisker_top = element.whiskers.top
        let whisker_btm = element.whiskers.bottom
        let q3 = element.Q3
        let q1 = element.Q1
        let driver = element.driver

        //laps
        if (this.bpprop.options['showIndividualLaps'].checked) {
          for (let d = laps.length - 1, lap; lap = laps[d]; d--) {
            if (x_mouse >= (lap.x - this.bpprop.carclass1.laps.prop.radius_HITBOX) && x_mouse <= lap.x + this.bpprop.carclass1.laps.prop.radius_HITBOX && y_mouse >= (lap.y - this.bpprop.carclass1.laps.prop.radius_HITBOX) && y_mouse <= (lap.y + this.bpprop.carclass1.laps.prop.radius_HITBOX)) {
              this.highlightedDriver = this.data.drivers[i]
              this.highlightedDetailType = DetailType.LAP
              this.highlightedLap = laps[d].y
              this._showLabelDetail = true
              this._showLabelDetail_lapNr = true
              break outerloop
            } else {
              this._showLabelDetail = false
              this._showLabelDetail_lapNr = false
            }
          }
        }

        // mean
        if (this.bpprop.options['showMean'].checked) {
          if (x_mouse >= (mean.x - this.bpprop.carclass1.mean.prop.radius_HITBOX) && x_mouse <= (mean.x + this.bpprop.carclass1.mean.prop.radius_HITBOX) && y_mouse >= (mean.y - this.bpprop.carclass1.mean.prop.radius_HITBOX) && y_mouse <= (mean.y + this.bpprop.carclass1.mean.prop.radius_HITBOX)) {
            this.highlightedDriver = this.data.drivers[i]
            this.highlightedDetailType = DetailType.MEAN
            this._showLabelDetail = true
            break
          } else {
            this._showLabelDetail = false
          }
        }

        // median
        if (x_mouse >= median.x.start && x_mouse <= median.x.end && y_mouse >= median.y - this.bpprop.carclass1.median.prop.lineThickness_HITBOX && y_mouse <= median.y + this.bpprop.carclass1.median.prop.lineThickness_HITBOX) {
          this.highlightedDriver = this.data.drivers[i]
          this.highlightedDetailType = DetailType.MEDIAN
          this._showLabelDetail = true
          break
        } else {
          this._showLabelDetail = false
        }

        // whisker-top
        if (x_mouse >= whisker_top.x.start && x_mouse <= whisker_top.x.end && y_mouse >= whisker_top.y - this.bpprop.carclass1.whiskers.prop.lineThickness_HITBOX && y_mouse <= whisker_top.y + this.bpprop.carclass1.whiskers.prop.lineThickness_HITBOX) {
          this.highlightedDriver = this.data.drivers[i]
          this.highlightedDetailType = DetailType.WHISKER_TOP
          this._showLabelDetail = true
          break
        } else {
          this._showLabelDetail = false
        }

        //whisker-bottom
        if (x_mouse >= whisker_btm.x.start && x_mouse <= whisker_btm.x.end && y_mouse >= whisker_btm.y - this.bpprop.carclass1.whiskers.prop.lineThickness_HITBOX && y_mouse <= whisker_btm.y + this.bpprop.carclass1.whiskers.prop.lineThickness_HITBOX) {
          this.highlightedDriver = this.data.drivers[i]
          this.highlightedDetailType = DetailType.WHISKER_BOTTOM
          this._showLabelDetail = true
          break
        } else {
          this._showLabelDetail = false
        }

        //q3
        if (x_mouse >= q3.x.start && x_mouse <= q3.x.end && y_mouse >= q3.y - this.bpprop.carclass1.q3.prop.lineThickness_HITBOX && y_mouse <= q3.y + this.bpprop.carclass1.q3.prop.lineThickness_HITBOX) {
          this.highlightedDriver = this.data.drivers[i]
          this.highlightedDetailType = DetailType.Q3
          this._showLabelDetail = true
          break
        } else {
          this._showLabelDetail = false
        }

        //q1
        if (x_mouse >= q1.x.start && x_mouse <= q1.x.end && y_mouse >= q1.y - this.bpprop.carclass1.q1.prop.lineThickness_HITBOX && y_mouse <= q1.y + this.bpprop.carclass1.q1.prop.lineThickness_HITBOX) {
          this.highlightedDriver = this.data.drivers[i]
          this.highlightedDetailType = DetailType.Q1
          this._showLabelDetail = true
          break
        } else {
          this._showLabelDetail = false
        }
      }

  }

  private initSVGs() {
    this.svgTime.nativeElement.style.height = this.appHeight + "px"
    this.svgTime.nativeElement.style.width = "130px"

    let svgName_width = this.appWidth + 150 + "px"
    this.svgName.nativeElement.style.top = "550px"
    this.svgName.nativeElement.style.height = this.appHeight + "px"
    this.svgName.nativeElement.style.width = this.appWidth + 150 + "px"

    let separator = document.createElementNS("http://www.w3.org/2000/svg", "rect")

    separator.setAttribute("width", svgName_width)
    separator.setAttribute("height", "1px")
    separator.setAttribute("fill", "rgba(105, 114, 125, 0.31)")
    separator.setAttribute("y", "0px")

    this.svgName.nativeElement.append(separator)
  }

  private prepareData(data: EventData) {

    data = structuredClone(data)

    // set user driver in diaprop
    for (let i = 0; i < data.drivers.length; i++) {
      if (this.cust_id == data.drivers[i].id) {
        this.diaprop.userDriver = data.drivers[i]
      }
    }

    if (!this.bpprop.options['showMulticlass'].checked) {
      data = this.removeCarClasses(data)
    }

    if(!this.bpprop.options['showDiscDisq'].checked) {
      data = this.removeDiscDisqDrivers(data)
    }

    if(this.bpprop.options['sortBySpeed'].checked) {
      data = this.sortByMedian(data)
      data = this.assignNewFinishPosition(data)
    }

    return data
  }

  private removeDiscDisqDrivers(data: EventData) {

    let drivers_new = new Array<Driver>()

    for (let i = 0; i < data.drivers.length; i++) {
      if (data.drivers[i].result_status == "Running") {
        drivers_new.push(data.drivers[i])
      }
    }

    let data_new = structuredClone(data)
    data_new.drivers = drivers_new

    return data_new
  }

  private dataTypeHighlighted(type: DetailType) {
    return this.highlightedDetailType == type;
  }

  private driverRunning(driver: Driver) {
    return driver.result_status == "Running";
  }

  private driverSelected(driver: Driver) {
    return driver == this.highlightedDriver;
  }

  private setColor_Box(driver: Driver) {

    if (driver.name == this.diaprop.userDriver.name) {
      this.context.fillStyle = this.bpprop.carclass1.bp.color.user.bg
      this.context.strokeStyle = this.bpprop.carclass1.bp.color.user.line
    } else {
      if (driver.car_class_id == this.diaprop.userDriver.car_class_id) {
        this.context.fillStyle = this.bpprop.carclass1.bp.color.running.bg
        this.context.strokeStyle = this.bpprop.carclass1.bp.color.running.line
      } else {
        let carclassProp = this.setBprop_carclass(driver)
        this.context.fillStyle = carclassProp.bp.color.running.bg
        this.context.strokeStyle = carclassProp.bp.color.running.line
      }
    }

    if (driver.result_status == "Disconnected" || driver.result_status == "Disqualified") {
      this.context.fillStyle = this.bpprop.carclass1.bp.color.disc.bg
      this.context.strokeStyle = this.bpprop.carclass1.bp.color.disc.line
    }
  }

  private setColor_Median(driver: Driver) {

    // default median color
    this.context.strokeStyle = this.bpprop.carclass1.median.color.running.line

    // username
    if (driver.name == this.diaprop.userDriver.name) {
      this.context.strokeStyle = this.bpprop.carclass1.median.color.user.line
    } else {
      if (driver.car_class_id == this.diaprop.userDriver.car_class_id) {
        this.context.strokeStyle = this.bpprop.carclass1.median.color.running.line
      } else {
        let carclassProp = this.setBprop_carclass(driver)
        this.context.strokeStyle = carclassProp.median.color.running.line
      }
    }

    // faster drivers = red / slower name = green / user name = yellow
    if (this.bpprop.options['showFasterSlower'].checked) {

      if (driver.bpdata.median > this.diaprop.userDriver.bpdata.median) {
        this.context.strokeStyle = this.bpprop.carclass1.median.color.slower.line
      }
      if (driver.bpdata.median < this.diaprop.userDriver.bpdata.median) {
        this.context.strokeStyle = this.bpprop.carclass1.median.color.faster.line
      }
      if (driver.name == this.diaprop.userDriver.name) {
        this.context.strokeStyle = this.bpprop.carclass1.median.color.user.highlight.line
      }
    }

    // disc, disq = grey
    if (driver.result_status == "Disconnected" || driver.result_status == "Disqualified") {
      this.context.strokeStyle = this.bpprop.carclass1.median.color.disc.line
    }
  }

  private setColor_Mean() {
    this.context.fillStyle = this.bpprop.carclass1.mean.color.line
  }

  private setColor_Whiskers(driver: Driver) {

    if (driver.result_status == "Disconnected" || driver.result_status == "Disqualified") {
      this.context.strokeStyle = this.bpprop.carclass1.whiskers.color.disc.line
    } else if (driver.name == this.diaprop.userDriver.name) {
      this.context.strokeStyle = this.bpprop.carclass1.whiskers.color.user.line
    } else if (driver.car_class_id == this.diaprop.userDriver.car_class_id) {
      this.context.strokeStyle = this.bpprop.carclass1.whiskers.color.running.line
    } else {
      let carclassProp = this.setBprop_carclass(driver)
      this.context.strokeStyle = carclassProp.whiskers.color.running.line
    }

  }

  private setColor_Fliers() {
    this.context.strokeStyle = this.bpprop.carclass1.fliers.color
  }

  private updateDiagram() {
    this.diaprop = new DiagramProperties()
    this.data = this.prepareData(this.data_original)
    this.initBpprop()
    this.initDiaprop()
    this.drawSVG_Y_laptimeLabels()
    this.drawSVG_X_driverLabels()
  }

  private initBpprop() {

    // reset bp-width
    this.bpprop.carclass1.bp.prop.width = 200

    // if multiclass: for each car-class, assign a specific property-object (= color scheme)
    if (this.bpprop.options['showMulticlass'].checked && this.data.metadata.carclasses.length > 1) {
      let listWithoutUserCarclass = this.data.metadata.carclasses.filter(item => item !== this.diaprop.userDriver.car_class_id)
      let listOfCarclassProps = [this.bpprop.carclass2, this.bpprop.carclass3, this.bpprop.carclass4, this.bpprop.carclass5]

            while (listWithoutUserCarclass.length < listOfCarclassProps.length) {
        listOfCarclassProps = listOfCarclassProps.splice(0,listOfCarclassProps.length-1)
      }

      for (let i = 0; i < listWithoutUserCarclass.length; i++) {
        listOfCarclassProps[i].carclass_id = listWithoutUserCarclass[i]
      }
    }
  }

  private removeCarClasses(data: EventData) {

    let drivers_new = new Array<Driver>()

    let userDriverClass = this.findUserCarClass(data)

    for (let i = 0; i < data.drivers.length; i++) {
      if (data.drivers[i].car_class_id == userDriverClass) {
        drivers_new.push(data.drivers[i])
      }
    }

    let data_new = structuredClone(data)
    data_new.drivers = drivers_new

    if (this.bpprop.options["showDiscDisq"].checked) {
      return data_new
    } else {
      return this.removeDiscDisqDrivers(data_new)
    }
  }

  private findUserCarClass(data: EventData) {

    let carClassID: number = 0

    for (let i = 0; i < data.drivers.length; i++) {
      if (data.drivers[i].name == this.diaprop.userDriver.name) {
        carClassID = data.drivers[i].car_class_id

      }
    }
    return carClassID
  }

  private setBprop_carclass(driver: Driver) {

    switch (driver.car_class_id) {
      case this.bpprop.carclass2.carclass_id: return this.bpprop.carclass2
      case this.bpprop.carclass3.carclass_id: return this.bpprop.carclass3
      case this.bpprop.carclass4.carclass_id: return this.bpprop.carclass4
      case this.bpprop.carclass5.carclass_id: return this.bpprop.carclass5
      default: return this.bpprop.carclass1
    }
  }

  private handleMouseUp(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    this.isDown = false
  }

  private handleMouseDown(event: MouseEvent) {

    event.preventDefault()
    event.stopPropagation()

    this.startX = event.clientX - this.cameraOffset.x
    this.startY = event.clientY - this.cameraOffset.y

    this.isDown = true
  }

  private handleMouseOut(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    this.isDown = false
  }

  private handleMouseMove(event: MouseEvent) {

    if (!this.isDown) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    this.cameraOffset.x = event.clientX - this.startX
    this.cameraOffset.y = event.clientY - this.startY

    this.applyScale()

    this.drawSVG_Y_laptimeLabels()
    this.drawSVG_X_driverLabels()
  }

  private scaleCanvas(event: WheelEvent) {
    event.preventDefault()
    event.stopPropagation()
    let previousScale: xy = {x: this.scale.x, y: this.scale.y}
    let direction = event.deltaY > 0 ? -1 : 1

    this.scale.x = this.scale.x + this.scaleFactor * direction
    this.scale.y = this.scale.y + this.scaleFactor * direction

    this.label_scale = this.scale.y.toFixed(1)

    this.scrollX += ((event.offsetX - this.cameraOffset.x) / previousScale.x) - ((event.offsetX - this.cameraOffset.x) / this.scale.x);
    this.scrollY += ((event.offsetY - this.cameraOffset.y) / previousScale.y) - ((event.offsetY - this.cameraOffset.y) / this.scale.y);

    this.applyScale()
  }

  private applyScale() {
    this.canvas.nativeElement.width = this.appWidth
    this.canvas.nativeElement.height = this.appHeight

    this.context.setTransform(1, 0, 0, 1, this.cameraOffset.x, this.cameraOffset.y)
    this.context.scale(this.scale.x, this.scale.y)

    this.canvasAxis.nativeElement.width = 20
    this.canvasAxis.nativeElement.height = this.appHeight

    this.contextAxis.setTransform(1, 0, 0, 1, 0, this.cameraOffset.y)
    this.contextAxis.scale(this.scale.x, this.scale.y)
  }

  private initDiaprop() {
    this.diaprop.yAxisTicks_end = this.data.metadata.timeframe[1]
    this.diaprop.calculateLinearFunction(this.data.metadata.median, this.appHeight)
    this.diaprop.renderStart.y = this.convertSecondsToPixels(this.data.metadata.timeframe[1])
    this.diaprop.renderEnd.y = this.convertSecondsToPixels(this.data.metadata.timeframe[0])
    this.dataService.mainAcc.pipe(takeUntil(this.stop$)).subscribe(id => this.cust_id = id?.custId!)
    this.diaprop.userDriver = this.findUserDriver(this.cust_id)
  }

  private clearCanvas() {

    this.context.clearRect(
      0 - this.cameraOffset.x / this.scale.x,
      0 - this.cameraOffset.y / this.scale.y,
      this.context.canvas.width / this.scale.x,
      this.context.canvas.height / this.scale.y)

    this.contextAxis.clearRect(
      0,
      0 - this.cameraOffset.y / this.scale.y,
      this.contextAxis.canvas.width / this.scale.x,
      this.contextAxis.canvas.height / this.scale.y)
  }

  private sortByMedian(data: EventData) {
    data.drivers.sort((a,b) => b.bpdata.median - a.bpdata.median).reverse()
    return data
  }

  private assignNewFinishPosition(data: EventData) {

    if(this.bpprop.options['showMulticlass'].checked) {
      for (let i = 0; i < data.drivers.length; i++) {
        let finishPos_orig = data.drivers[i].finish_position
        data.drivers[i].finish_position = i+1 + " (" + finishPos_orig +")"
      }

    } else {

      for (let i = 0; i < data.drivers.length; i++) {
        let finishPosInClass_orig = data.drivers[i].finish_position_in_class
        data.drivers[i].finish_position_in_class = i+1 + " (" + finishPosInClass_orig +")"
      }

    }

    return data
  }

  private drawDetailLabels() {

    for (const [i, element] of this.data_live.entries()) {

      if (this.driverSelected(element.driver) && this.driverRunning(element.driver)) {

        if (!this._showLabelDetail_lapNr) {
          this.labelDetail.nativeElement.style.padding = "0px 5px 0px 5px"
        }
        if (this.highlightedDetailType == DetailType.MEDIAN) {
          this.drawMedianLabel_R(element)
        }
        if (this.highlightedDetailType == DetailType.MEAN) {
          this.drawMeanLabel_R(element)
        }
        if (this.highlightedDetailType == DetailType.Q1 || this.highlightedDetailType == DetailType.Q3) {
          this.drawQLabel_R(element)
        }
        if (this.highlightedDetailType == DetailType.WHISKER_TOP || this.highlightedDetailType == DetailType.WHISKER_BOTTOM) {
          this.drawWhiskerLabel_R(element)
        }


      } else if (this.driverSelected(element.driver) && !this.driverRunning(element.driver)) {

        if (!this._showLabelDetail_lapNr) {
          this.labelDetail.nativeElement.style.padding = "0px 5px 0px 5px"
        }

        if (this.highlightedDetailType == DetailType.MEDIAN) {
          this.drawMedianLabel_D(element)
        }
        if (this.highlightedDetailType == DetailType.MEAN) {
          this.drawMeanLabel_D(element)
        }
        if (this.highlightedDetailType == DetailType.Q1 || this.highlightedDetailType == DetailType.Q3) {
          this.drawQLabel_D(element)
        }
        if (this.highlightedDetailType == DetailType.WHISKER_TOP || this.highlightedDetailType == DetailType.WHISKER_BOTTOM) {
          this.drawWhiskerLabel_D(element)
        }
      }
    }
  }

  private drawMedianLabel_R(element: BoxplotElement) {

    let x_pos = element.median.x.end
    let y_pos = element.median.y
    let time = element.driver.bpdata.median
    let driver = element.driver

    x_pos = x_pos * this.scale.x + 150 + this.cameraOffset.x
    y_pos = y_pos * this.scale.y - 15 + this.cameraOffset.y

    let time_str = this.convertTimeFormat(time)

    this.context.beginPath()
    this.labelDetail.nativeElement.style.top = y_pos + "px"
    this.labelDetail.nativeElement.style.left = x_pos + this.diaprop.laptime_detail_q1q3median_gap + "px"
    this.labelDetailTime_content = time_str

    this.labelDetail.nativeElement.style.borderColor = this.bpprop.carclass1.median.color.running.detail.line
    this.labelDetail.nativeElement.style.background = this.bpprop.carclass1.median.color.running.detail.bg

    if (this.bpprop.options['showMulticlass'].checked && this.diaprop.userDriver.car_class_id != driver.car_class_id) {
      let carclassProp = this.setBprop_carclass(driver)
      this.labelDetail.nativeElement.style.borderColor = carclassProp.median.color.running.detail.line
      this.labelDetail.nativeElement.style.background = carclassProp.median.color.running.detail.bg
    }

    if (this.bpprop.options['showFasterSlower'].checked) {

      let delta = element.driver.bpdata.median - this.diaprop.userDriver.bpdata.median

      if (delta > 0) {
        this.labelDetailTime_content = time_str + " (" + "+" + delta.toFixed(3).toString() + ")"
      } else if (delta < 0) {
        this.labelDetailTime_content = time_str + " (" + delta.toFixed(3).toString() + ")"
      } else {
        this.labelDetailTime_content = time_str
      }

      if (element.driver.bpdata.median > this.diaprop.userDriver.bpdata.median) {
        this.labelDetail.nativeElement.style.borderColor = this.bpprop.carclass1.median.color.slower.detail.line
        this.labelDetail.nativeElement.style.background = this.bpprop.carclass1.median.color.slower.detail.bg
      } else {
        this.labelDetail.nativeElement.style.borderColor = this.bpprop.carclass1.median.color.faster.detail.line
        this.labelDetail.nativeElement.style.background = this.bpprop.carclass1.median.color.faster.detail.bg
      }

      if (element.driver.name == this.diaprop.userDriver.name) {
        this.labelDetail.nativeElement.style.borderColor = this.bpprop.carclass1.median.color.user.highlight.detail.line
        this.labelDetail.nativeElement.style.background = this.bpprop.carclass1.median.color.user.highlight.detail.bg
      }
    }

    this.context.stroke()
  }

  private drawMedianLabel_D(element: BoxplotElement) {

    let x_pos = element.median.x.end
    let y_pos = element.median.y
    let time = element.driver.bpdata.median

    x_pos = x_pos * this.scale.x + 150 + this.cameraOffset.x
    y_pos = y_pos * this.scale.y - 15 + this.cameraOffset.y

    let time_str = this.convertTimeFormat(time)

    this.context.beginPath()
    this.labelDetail.nativeElement.style.top = y_pos + "px"
    this.labelDetail.nativeElement.style.left = x_pos + this.diaprop.laptime_detail_q1q3median_gap + "px"
    this.labelDetailTime_content = time_str
    this.labelDetail.nativeElement.style.borderColor = this.bpprop.carclass1.median.color.disc.detail.line
    this.labelDetail.nativeElement.style.background = this.bpprop.carclass1.median.color.disc.detail.bg
    this.context.stroke()

  }

  private drawMeanLabel_R(element: BoxplotElement) {
    let x_pos = element.mean.x
    let y_pos = element.mean.y
    let time = element.driver.bpdata.mean
    let driver = element.driver

    x_pos = x_pos * this.scale.x + 150 + this.cameraOffset.x
    y_pos = y_pos * this.scale.y - 15 + this.cameraOffset.y

    let time_str = this.convertTimeFormat(time)

    this.context.beginPath()
    this.labelDetail.nativeElement.style.top = y_pos + "px"
    this.labelDetail.nativeElement.style.left = x_pos + this.diaprop.laptime_detail_dot_gap + "px"
    this.labelDetailTime_content = time_str
    this.labelDetail.nativeElement.style.borderColor = this.bpprop.carclass1.mean.color.detail.line
    this.labelDetail.nativeElement.style.background = this.bpprop.carclass1.mean.color.detail.bg

    if (this.bpprop.options['showFasterSlower'].checked) {
      let delta = (driver.bpdata.mean - this.diaprop.userDriver.bpdata.mean)

      if (delta > 0) {
        this.labelDetailTime_content = time_str + " (" + "+" + delta.toFixed(3).toString() + ")"
      } else if (delta < 0) {
        this.labelDetailTime_content = time_str + " (" + delta.toFixed(3).toString() + ")"
      } else {
        this.labelDetailTime_content = time_str
      }
    }

    this.context.stroke()

  }

  private drawQLabel_R(element: BoxplotElement) {
    let x_pos: number
    let y_pos: number
    let time: number
    let driver: Driver = element.driver

    if (this.highlightedDetailType == DetailType.Q1) {
      x_pos = element.Q1.x.end
      y_pos = element.Q1.y
      time = element.driver.bpdata.Q1
    } else {
      x_pos = element.Q3.x.end
      y_pos = element.Q3.y
      time = element.driver.bpdata.Q3
    }

    x_pos = x_pos * this.scale.x + 150 + this.cameraOffset.x
    y_pos = y_pos * this.scale.y - 15 + this.cameraOffset.y

    let time_str = this.convertTimeFormat(time)

    this.context.beginPath()
    this.labelDetail.nativeElement.style.top = y_pos + "px"
    this.labelDetail.nativeElement.style.left = x_pos + this.diaprop.laptime_detail_q1q3median_gap + "px"
    this.labelDetailTime_content = time_str

    if (this.bpprop.options['showMulticlass'].checked && this.diaprop.userDriver.car_class_id != driver.car_class_id) {
      let carclassProp = this.setBprop_carclass(driver)
      this.labelDetail.nativeElement.style.borderColor = carclassProp.bp.color.running.detail.line
      this.labelDetail.nativeElement.style.background = carclassProp.bp.color.running.detail.bg
    } else {
      this.labelDetail.nativeElement.style.borderColor = this.bpprop.carclass1.bp.color.running.detail.line
      this.labelDetail.nativeElement.style.background = this.bpprop.carclass1.bp.color.running.detail.bg
    }

    this.context.stroke()

  }

  private drawWhiskerLabel_R(element: BoxplotElement) {
    let x_pos: number
    let y_pos: number
    let time: number
    let driver: Driver = element.driver

    if (this.highlightedDetailType == DetailType.WHISKER_TOP) {
      x_pos = element.whiskers.top.x.end
      y_pos = element.whiskers.top.y
      time = element.driver.bpdata.whisker_top
    } else {
      x_pos = element.whiskers.bottom.x.end
      y_pos = element.whiskers.bottom.y
      time = element.driver.bpdata.whisker_bottom
    }

    x_pos = x_pos * this.scale.x + 150 + this.cameraOffset.x
    y_pos = y_pos * this.scale.y - 15 + this.cameraOffset.y

    let time_str = this.convertTimeFormat(time)

    this.context.beginPath()
    this.labelDetail.nativeElement.style.top = y_pos + "px"
    this.labelDetail.nativeElement.style.left = x_pos + this.diaprop.laptime_detail_whisker_gap + "px"
    this.labelDetailTime_content = time_str

    if (this.bpprop.options['showMulticlass'].checked && this.diaprop.userDriver.car_class_id != driver.car_class_id) {
      let carclassProp = this.setBprop_carclass(driver)
      this.labelDetail.nativeElement.style.borderColor = carclassProp.whiskers.color.running.line
      this.labelDetail.nativeElement.style.background = carclassProp.whiskers.color.running.detail.bg
    } else {
      this.labelDetail.nativeElement.style.borderColor = this.bpprop.carclass1.whiskers.color.running.line
      this.labelDetail.nativeElement.style.background = this.bpprop.carclass1.whiskers.color.running.detail.bg
    }

    this.context.stroke()
  }

  private drawMeanLabel_D(element: BoxplotElement) {

    let x_pos = element.mean.x
    let y_pos = element.mean.y
    let time = element.driver.bpdata.mean

    x_pos = x_pos * this.scale.x + 150 + this.cameraOffset.x
    y_pos = y_pos * this.scale.y - 15 + this.cameraOffset.y

    let time_str = this.convertTimeFormat(time)

    this.context.beginPath()
    this.labelDetail.nativeElement.style.top = y_pos + "px"
    this.labelDetail.nativeElement.style.left = x_pos + this.diaprop.laptime_detail_dot_gap + "px"
    this.labelDetailTime_content = time_str
    this.labelDetail.nativeElement.style.borderColor = this.bpprop.carclass1.mean.color.detail.line
    this.labelDetail.nativeElement.style.background = this.bpprop.carclass1.mean.color.detail.bg
    this.context.stroke()

  }

  private drawQLabel_D(element: BoxplotElement) {
    let x_pos: number
    let y_pos: number
    let time: number

    if (this.highlightedDetailType == DetailType.Q1) {
      x_pos = element.Q1.x.end
      y_pos = element.Q1.y
      time = element.driver.bpdata.Q1
    } else {
      x_pos = element.Q3.x.end
      y_pos = element.Q3.y
      time = element.driver.bpdata.Q3
    }

    x_pos = x_pos * this.scale.x + 150 + this.cameraOffset.x
    y_pos = y_pos * this.scale.y - 15 + this.cameraOffset.y

    let time_str = this.convertTimeFormat(time)

    this.context.beginPath()
    this.labelDetail.nativeElement.style.top = y_pos + "px"
    this.labelDetail.nativeElement.style.left = x_pos + this.diaprop.laptime_detail_whisker_gap + "px"
    this.labelDetailTime_content = time_str
    this.labelDetail.nativeElement.style.borderColor = this.bpprop.carclass1.whiskers.color.disc.detail.line
    this.labelDetail.nativeElement.style.background = this.bpprop.carclass1.whiskers.color.disc.detail.bg
    this.context.stroke()
  }

  private drawWhiskerLabel_D(element: BoxplotElement) {
    let x_pos: number
    let y_pos: number
    let time: number

    if (this.highlightedDetailType == DetailType.WHISKER_TOP) {
      x_pos = element.whiskers.top.x.end
      y_pos = element.whiskers.top.y
      time = element.driver.bpdata.whisker_top
    } else {
      x_pos = element.whiskers.bottom.x.end
      y_pos = element.whiskers.bottom.y
      time = element.driver.bpdata.whisker_bottom
    }

    x_pos = x_pos * this.scale.x + 150 + this.cameraOffset.x
    y_pos = y_pos * this.scale.y - 15 + this.cameraOffset.y

    let time_str = this.convertTimeFormat(time)

    this.context.beginPath()
    this.labelDetail.nativeElement.style.top = y_pos + "px"
    this.labelDetail.nativeElement.style.left = x_pos + this.diaprop.laptime_detail_q1q3median_gap + "px"
    this.labelDetailTime_content = time_str
    this.labelDetail.nativeElement.style.borderColor = this.bpprop.carclass1.bp.color.disc.line
    this.labelDetail.nativeElement.style.background = this.bpprop.carclass1.bp.color.disc.bg

    this.context.stroke()
  }

  private drawLapLabel_R(x_pos: number, y_pos: number, type: number, time: number, lapNr: number) {
    x_pos = x_pos * this.scale.x + 150 + this.cameraOffset.x
    y_pos = y_pos * this.scale.y - 15 + this.cameraOffset.y

    this.labelDetail.nativeElement.style.top = y_pos + "px"

    let time_str = this.convertTimeFormat(time)
    let lapNr_str = lapNr.toString()

    if (type == DetailType.LAP) {
      this.labelDetail.nativeElement.style.left = x_pos + this.diaprop.laptime_detail_dot_gap + "px"
      this.labelDetailTime_content = time_str
      this.labelDetailLap_content = lapNr_str
      this.labelDetail.nativeElement.style.padding = "0px 0px 0px 5px"
      this.labelDetail.nativeElement.style.borderColor = this.bpprop.carclass1.laps.color.normal.detail.line
      this.labelDetail.nativeElement.style.background = this.bpprop.carclass1.laps.color.normal.detail.bg
    }
  }

  private drawLaps_Incident(driver: Driver, showIncidents: bpoption) {

    console.log(driver.laps.entries())

    for (const [i, lap] of driver.laps.entries()) {
      let lap_x = (this.bpprop.carclass1.bp.prop.middle + driver.bpdata.laps_rndFactors[i]) - this.scrollX
      let lap_y = this.convertSecondsToPixels(lap) - this.scrollY

      this.context.beginPath()

      // if (this.driverSelected(driver) && this.highlightedLap == lap_y) {
      //   this.context.arc(lap_x, lap_y, this.bpprop.carclass1.laps.prop.radius_SELECT, 0, (Math.PI / 180) * 360)
      //   this.drawLapLabel_R(lap_x, lap_y, DetailType.LAP, lap, i + 1)
      // } else {
        this.context.arc(lap_x, lap_y, this.bpprop.carclass1.laps.prop.radius_DEFAULT, 0, (Math.PI / 180) * 360)
      // }

      this.context.fillStyle = this.bpprop.carclass1.laps.color.normal.line
      this.context.fill()

      return {x: lap_x, y: lap_y, fastestPersonal: false, fastestOverall: false, incident: false}
    }

    return {x: null, y: null, fastestPersonal: false, fastestOverall: false, incident: false}
  }

  private drawLaps_All(driver: Driver, lapsArray: Array<Lap>) {

    for (const [i, lap] of driver.laps.entries()) {
      let lap_x = (this.bpprop.carclass1.bp.prop.middle + driver.bpdata.laps_rndFactors[i]) - this.scrollX
      let lap_y = this.convertSecondsToPixels(lap) - this.scrollY

      this.context.beginPath()

      if (this.driverSelected(driver) && this.highlightedLap == lap_y) {
        this.context.arc(lap_x, lap_y, this.bpprop.carclass1.laps.prop.radius_SELECT, 0, (Math.PI / 180) * 360)
        this.drawLapLabel_R(lap_x, lap_y, DetailType.LAP, lap, i + 1)
      } else {
        this.context.arc(lap_x, lap_y, this.bpprop.carclass1.laps.prop.radius_DEFAULT, 0, (Math.PI / 180) * 360)
      }

      this.context.fillStyle = this.bpprop.carclass1.laps.color.normal.line
      this.context.fill()

      lapsArray.push({x: lap_x, y: lap_y, fastestPersonal: false, fastestOverall: false, incident: false})
    }
  }

  private findUserDriver(id: number) {
    for (let i = 0; i < this.data_original.drivers.length; i++) {
      if (id == this.data_original.drivers[i].id) {
        return this.data_original.drivers[i]
      }
    }
    return new Driver()
  }
}

export class BoxplotProperties {

  private static _instance: BoxplotProperties

  private constructor() {
  }

  static getInstance(): BoxplotProperties {
    if (!BoxplotProperties._instance) {
      BoxplotProperties._instance = new BoxplotProperties()
    }
    return BoxplotProperties._instance
  }

  // carclass1 as default
  carclass1 = {
    carclass_id: 0, // calculated
    bp: {
      color: {
        running: {
          bg: "rgba(0,27,59,0.2)",
          line: "#1a88ff",
          detail: {
            bg: "#093059",
            line: "#1a88ff"
          }
        },
        disc: {
          bg: "rgba(77,77,77,0.4)",
          line: "#999999",
          detail: {
            bg: "rgb(51,51,51)",
            line: "#999999",
          }
        },
        user: {
          bg: "rgba(166,206,255,0.2)",
          line: "#a6cfff",
          detail: {
            bg: "#d000ff",
            line: "#d000ff"
          }
        },
      },
      prop: {
        width: 200, // start-value - exact value to be determined
        location: 0, // calculated
        middle: 0, // calculated
        gap: 14
      }
      },
    q1: {
      prop: {
        lineThickness_DEFAULT: 2,
        lineThickness_HITBOX: 3,
        lineThickness_SELECT: 4
      }
    },
    q3: {
      prop: {
        lineThickness_DEFAULT: 2,
        lineThickness_HITBOX: 3,
        lineThickness_SELECT: 4

      }
    },
    median: {
      color: {
        running: {
          line: "#22ff1a",
          detail: {
            bg: "#063306",
            line: "#22ff1a"
          }
        },
        disc: {
          line: "#999999",
          detail: {
            bg: "rgb(51,51,51)",
            line: "#999999"
          },
        },
        user: {
          line: "#22ff1a",
          highlight: {
            line: "#ffd900",
            detail: {
              line: "#ffd900",
              bg: "#4d4900"
            }
          },
          detail: {
            bg: "#063306",
            line: "#22ff1a",
          },
        },
        faster: {
          line: "#ff0000",
          detail: {
            bg: "#590000",
            line: "#ff0000"
          }
        },
        slower: {
          line: "#22ff1a",
          detail: {
            bg: "#063306",
            line: "#22ff1a"
          }
        },
      },
      prop: {
        width: 0,
        lineThickness_DEFAULT: 2,
        lineThickness_SELECT: 3,
        lineThickness_HITBOX: 4,
      }
    },
    mean: {
      color: {
        line: "#ff0000",
        detail: {
          bg: "#590000",
          line: "#ff0000"
        }
      },
      prop: {
        radius_DEFAULT: 4,
        radius_SELECT: 5,
        radius_HITBOX: 5,
      }
    },
    whiskers: {
      color: {
        running: {
          line: "#76b3ff",
          detail: {
            line: "#76b3ff",
            bg: "#293f59"
          }
        },
        disc: {
          line: "#999999",
          detail: {
            line: "#999999",
            bg: "rgb(51,51,51)"
          }
        },
        user: {
          line: "#a6cfff"
        },
      },
      prop: {
        width: 0, // calculated
        lineThickness_DEFAULT: 2,
        lineThickness_HITBOX: 2,
        lineThickness_SELECT: 4
      }
    },
    laps: {
      color: {
        normal: {
          line: "#fffb00",
          detail: {
            line: "#fffb00",
            bg: "#4d4900"
          }

        },
        fastest: {
          line: "#f700ff",
          detail: {
            line: "#fffb00",
            bg: "#4d4900"
          }
        },
        incident: {
          line: "#ff7300",
          detail: {
            line: "#fffb00",
            bg: "#4d4900"
          }
        },
      },
      prop: {
        radius_DEFAULT: 2,
        radius_HITBOX: 2.5,
        radius_SELECT: 2.5
      }
    },
    fliers: {
      color: "rgba(176,176,176)",
      radius: 3.5,
      lineThickness: 0.7
    },
  }
  carclass2 = {
    carclass_id: 0,
    bp: {
      color: {
        running: {
          bg: "rgba(59,37,89,0.2)",
          line: "#AE6BFF",
          detail: {
            bg: "#2b1b40",
            line: "#AE6BFF"
          }
        },
        disc: {
          bg: "rgba(77,77,77,0.4)",
          line: "#999999",
          detail: {
            bg: "rgb(51,51,51)",
            line: "#999999",
          }
        },
      },
    },
    median: {
      color: {
        running: {
          line: "#AE6BFF",
          detail: {
            bg: "#2b1b40",
            line: "#AE6BFF"
          }
        },
        disc: {
          line: "#999999",
          detail: {
            bg: "rgb(51,51,51)",
            line: "#999999"
          },
        },
        user: {
          line: "#AE6BFF",
          highlight: {
            line: "#ffd900",
            detail: {
              line: "#ffd900",
              bg: "#4d4900"
            }
          },
          detail: {
            bg: "#063306",
            line: "#22ff1a",
          },
        },
        faster: {
          line: "#ff0000",
          detail: {
            bg: "#590000",
            line: "#ff0000"
          }
        },
        slower: {
          line: "#22ff1a",
          detail: {
            bg: "#063306",
            line: "#22ff1a"
          }
        },
      },
      prop: {
        width: 0,
        lineThickness_DEFAULT: 2,
        lineThickness_SELECT: 3,
        lineThickness_HITBOX: 4,
      }
    },
    mean: {
      color: {
        line: "#ff0000",
        detail: {
          bg: "#590000",
          line: "#ff0000"
        }
      },
      prop: {
        radius_DEFAULT: 4,
        radius_SELECT: 5,
        radius_HITBOX: 5,
      }
    },
    whiskers: {
      color: {
        running: {
          line: "#a087a8",
          detail: {
            line: "#a087a8",
            bg: "#3c3340"
          }
        },
        disc: {
          line: "#999999",
          detail: {
            line: "#999999",
            bg: "rgb(51,51,51)"
          }
        },
      },
    },
    laps: {
      color: {
        line: "#fffb00",
        detail: {
          line: "#fffb00",
          bg: "#4d4900"
        }
      },
    },
    fliers: {
      color: "rgba(176,176,176)",
      radius: 3.5,
      lineThickness: 0.7
    },
  }
  carclass3 = {
    carclass_id: 0,
    bp: {
      color: {
        running: {
          bg: "rgba(89,76,29,0.3)",
          line: "#FFDA59",
          detail: {
            bg: "#403716",
            line: "#FFDA59"
          }
        },
        disc: {
          bg: "rgba(77,77,77,0.4)",
          line: "#999999",
          detail: {
            bg: "rgb(51,51,51)",
            line: "#999999",
          }
        },
      },
    },
    median: {
      color: {
        running: {
          line: "#FFDA59",
          detail: {
            bg: "#403716",
            line: "#FFDA59"
          }
        },
        disc: {
          line: "#999999",
          detail: {
            bg: "rgb(51,51,51)",
            line: "#999999"
          },
        },
        user: {
          line: "#22ff1a",
          highlight: {
            line: "#ffd900",
            detail: {
              line: "#ffd900",
              bg: "#4d4900"
            }
          },
          detail: {
            bg: "#063306",
            line: "#22ff1a",
          },
        },
        faster: {
          line: "#ff0000",
          detail: {
            bg: "#590000",
            line: "#ff0000"
          }
        },
        slower: {
          line: "#22ff1a",
          detail: {
            bg: "#063306",
            line: "#22ff1a"
          }
        },
      },
      prop: {
        width: 0,
        lineThickness_DEFAULT: 2,
        lineThickness_SELECT: 3,
        lineThickness_HITBOX: 4,
      }
    },
    mean: {
      color: {
        line: "#ff0000",
        detail: {
          bg: "#590000",
          line: "#ff0000"
        }
      },
      prop: {
        radius_DEFAULT: 4,
        radius_SELECT: 5,
        radius_HITBOX: 5,
      }
    },
    whiskers: {
      color: {
        running: {
          line: "#a3a87e",
          detail: {
            line: "#a3a87e",
            bg: "#3e402f"
          }
        },
        disc: {
          line: "#999999",
          detail: {
            line: "#999999",
            bg: "rgb(51,51,51)"
          }
        },
      },
    },
    laps: {
      color: {
        line: "#fffb00",
        detail: {
          line: "#fffb00",
          bg: "#4d4900"
        }
      },
    },
    fliers: {
      color: "rgba(176,176,176)",
      radius: 3.5,
      lineThickness: 0.7
    }
  }
  carclass4 = {
    carclass_id: 0,
    bp: {
      color: {
        running: {
          bg: "rgba(89,29,47,0.2)",
          line: "#FF5888",
          detail: {
            bg: "#401622",
            line: "#FF5888"
          }
        },
        disc: {
          bg: "rgba(77,77,77,0.4)",
          line: "#999999",
          detail: {
            bg: "rgb(51,51,51)",
            line: "#999999",
          }
        },
      },
    },
    median: {
      color: {
        running: {
          line: "#FF5888",
          detail: {
            bg: "#401622",
            line: "#FF5888"
          }
        },
        disc: {
          line: "#999999",
          detail: {
            bg: "rgb(51,51,51)",
            line: "#999999"
          },
        },
        faster: {
          line: "#ff0000",
          detail: {
            bg: "#590000",
            line: "#ff0000"
          }
        },
        slower: {
          line: "#22ff1a",
          detail: {
            bg: "#063306",
            line: "#22ff1a"
          }
        },
      }
    },
    mean: {
      color: {
        line: "#ff0000",
        detail: {
          bg: "#590000",
          line: "#ff0000"
        }
      },
      prop: {
        radius_DEFAULT: 4,
        radius_SELECT: 5,
        radius_HITBOX: 5,
      }
    },
    whiskers: {
      color: {
        running: {
          line: "#b38686",
          detail: {
            line: "#b38686",
            bg: "#403030"
          }
        },
        disc: {
          line: "#999999",
          detail: {
            line: "#999999",
            bg: "rgb(51,51,51)"
          }
        },
      },
    },
    laps: {
      color: {
        line: "#fffb00",
        detail: {
          line: "#fffb00",
          bg: "#4d4900"
        }
      },
    },
    fliers: {
      color: "rgba(176,176,176)",
    },
  }
  carclass5 = {
    carclass_id: 0,
    bp: {
      color: {
        running: {
          bg: "rgba(0,27,59,0.2)",
          line: "#24a8a8",
          detail: {
            bg: "#093059",
            line: "#24a8a8"
          }
        },
        disc: {
          bg: "rgba(77,77,77,0.4)",
          line: "#999999",
          detail: {
            bg: "rgb(51,51,51)",
            line: "#999999",
          }
        },
        user: {
          bg: "rgba(166,206,255,0.2)",
          line: "#a6cfff",
          detail: {
            bg: "#d000ff",
            line: "#d000ff"
          }
        },
      },
      prop: {
        width: 200, // start-value - exact value to be determined
        location: 0, // calculated
        middle: 0, // calculated
        gap: 14
      }
    },
    q1: {
      prop: {
        lineThickness_DEFAULT: 2,
        lineThickness_HITBOX: 3,
        lineThickness_SELECT: 4
      }
    },
    q3: {
      prop: {
        lineThickness_DEFAULT: 2,
        lineThickness_HITBOX: 3,
        lineThickness_SELECT: 4

      }
    },
    median: {
      color: {
        running: {
          line: "#22ff1a",
          detail: {
            bg: "#063306",
            line: "#22ff1a"
          }
        },
        disc: {
          line: "#999999",
          detail: {
            bg: "rgb(51,51,51)",
            line: "#999999"
          },
        },
        user: {
          line: "#22ff1a",
          highlight: {
            line: "#ffd900",
            detail: {
              line: "#ffd900",
              bg: "#4d4900"
            }
          },
          detail: {
            bg: "#063306",
            line: "#22ff1a",
          },
        },
        faster: {
          line: "#ff0000",
          detail: {
            bg: "#590000",
            line: "#ff0000"
          }
        },
        slower: {
          line: "#22ff1a",
          detail: {
            bg: "#063306",
            line: "#22ff1a"
          }
        },
      },
      prop: {
        width: 0,
        lineThickness_DEFAULT: 2,
        lineThickness_SELECT: 3,
        lineThickness_HITBOX: 4,
      }
    },
    mean: {
      color: {
        line: "#ff0000",
        detail: {
          bg: "#590000",
          line: "#ff0000"
        }
      },
      prop: {
        radius_DEFAULT: 4,
        radius_SELECT: 5,
        radius_HITBOX: 5,
      }
    },
    whiskers: {
      color: {
        running: {
          line: "#76b3ff",
          detail: {
            line: "#76b3ff",
            bg: "#293f59"
          }
        },
        disc: {
          line: "#999999",
          detail: {
            line: "#999999",
            bg: "rgb(51,51,51)"
          }
        },
        user: {
          line: "#a6cfff"
        },
      },
      prop: {
        width: 0, // calculated
        lineThickness_DEFAULT: 2,
        lineThickness_HITBOX: 2,
        lineThickness_SELECT: 4
      }
    },
    laps: {
      color: {
        line: "#fffb00",
        detail: {
          line: "#fffb00",
          bg: "#4d4900"
        }
      },
      prop: {
        radius_DEFAULT: 2,
        radius_HITBOX: 2.5,
        radius_SELECT: 2.5
      }
    },
    fliers: {
      color: "rgba(176,176,176)",
      radius: 3.5,
      lineThickness: 0.7
    },
  }

  options: Option_BP = {
    showDiscDisq: {label: "Show disconnected / disqualified drivers", checked: false},
    showIndividualLaps: {label: "Show individual laps", checked: false, suboptions: {
        showFastestLapOverall: {"label": "Overall fastest lap //", checked: false},
        showAllFastestLaps: {"label": "Fastest lap per driver // OR", checked: false},
        showIncidents: {"label": "Laps with incidents", checked: false}
      }},
    showMean: {label: "Show mean", checked: false},
    showFasterSlower: {label: "Highlight faster / slower drivers", checked: false},
    showMulticlass: {label: "Show all car classes", checked: false},
    sortBySpeed: {label: "Sort drivers from fastest to slowest", checked: false}
  }
}

class DiagramProperties {

  calculateLinearFunction(median: number, appHeight: number) {
    let x1 = median
    let y1 = appHeight / 2

    this.lineafunction_m = -this.fullTick_spacing
    this.linearfunction_t = y1 - (-this.fullTick_spacing * x1)
  }

  userDriver: Driver = new Driver()

  lineafunction_m: number // calculated
  linearfunction_t: number // calculated

  renderStart: xy = {x: 0, y: 0}
  renderEnd: xy = {x: 0, y: 0}

  yAxis_pos: number = 10
  yAxisTicks_start: number = 0
  yAxisTicks_end: number // calculated
  yAxis_color: string = "white"

  tickLabel_x: number = 41

  fullTick_width: number = 20
  fullTick_color: string = "rgba(255,255,255,0.3)"
  fullTick_spacing: number = 60
  fullTickLabel_fontSize: number = 22
  fullTickLabel_fontColor: string = "#ffffff"

  halfTick_width: number = 12
  halfTick_color: string = "rgba(255,255,255,0.22)"
  halfTickLabel_fontSize: number = 22
  halfTickLabel_fontColor: string = "#cccccc"

  quarterTick_width: number = 8
  quarterTick_color: string = "rgba(255,255,255,0.12)"

  yAxisBgWidth: number = this.yAxis_pos + this.fullTick_width/2

  laptime_detail_dot_gap: number = 20
  laptime_detail_whisker_gap: number = 5
  laptime_detail_q1q3median_gap: number = 5

  driverPositionLabel_y: number = 25
  driverPositionLabel_fontSize: number = 20
  driverPositionLabel_fontColor: string = "#dbdbdb"

  drivernameLabel_y: number = 55
  drivernameLabel_fontSize: number = 20
  drivernameLabel_fontColor: string = "#d9d9d9"
}

class BoxplotElement {

  driver: Driver

  Q3: {
    x: {
      start: number,
      end: number
    }
    y: number
  }

  Q1: {
    x: {
      start: number,
      end: number
    }
    y: number
  }

  median: {
    x: {
      start: number,
      end: number
    }
    y: number
  }

  mean: {
    x: number
    y: number
  }

  whiskers: {
    top: {
      x: {
        start: number
        end: number
      }
      y: number
    }

    bottom: {
      x: {
        start: number
        end: number
      }
      y: number
    }
  }

  fliers: {
    top: Array<Fliers>
    bottom: Array<Fliers>
  }

  laps: Array<Lap>
}

interface Fliers {
  x: number
  y: number
}

interface Lap {
  x: number
  y: number
  fastestPersonal: boolean
  fastestOverall: boolean
  incident: boolean

}

enum DetailType {
  MEDIAN,
  MEAN,
  LAP,
  WHISKER_TOP,
  WHISKER_BOTTOM,
  Q1,
  Q3
}

export interface Option_BP {
  [type: string]: {label: string, checked: boolean,
    suboptions?:
      {[type: string]: {label: string, checked: boolean}}
  }
}

export enum bpoption {
  showDiscDisq,
  showIndividualLaps ,
  showFastestLapOverall,
  showAllFastestLaps,
  showIncidents,
  showMean,
  showFasterSlower,
  showMulticlass,
  sortBySpeed
}

interface xy {
  x: number
  y: number
}
