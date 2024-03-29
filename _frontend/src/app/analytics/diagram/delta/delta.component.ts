import {AfterViewInit, Component, ElementRef, HostListener, ViewChild} from '@angular/core';
import {Subject} from "rxjs";
import {DataService} from "../../../_services/data.service";

@Component({
  selector: 'app-delta',
  templateUrl: './delta.component.html',
  styleUrls: ['./delta.component.scss']
})

export class DeltaComponent implements AfterViewInit {

  @ViewChild('canvas') canvas: ElementRef<HTMLCanvasElement>
  @ViewChild('labelDetail') label_detail: ElementRef<HTMLDivElement>
  label_scale = "1.0"
  show_label_detail: boolean
  label_detail_content: string
  private stop$ = new Subject<void>()
  private context: CanvasRenderingContext2D
  private appWidth: number
  private appHeight: number
  private scale: {x: number, y: number} = {x: 1, y: 1}
  private scaleFactor = 0.1
  private scrollX = 0
  private scrollY = 0
  private isDown: boolean
  private startX: number
  private startY: number
  private cameraOffset: {x: number, y: number} = {x:0,y:0}
  private scaledVertically: boolean = false

  constructor(private app: ElementRef, private dataService: DataService) {
  }

  ngAfterViewInit() {
    this.canvas.nativeElement.width = this.appWidth = this.app.nativeElement.parentNode.clientWidth - 130 // 1390
    this.canvas.nativeElement.height = this.appHeight = this.app.nativeElement.parentNode.clientHeight // 786
    this.context = this.canvas.nativeElement.getContext('2d')!
    this.context.setTransform(1, 0, 0, 1,this.cameraOffset.x,this.cameraOffset.y)
    this.context.canvas.focus()
    this.draw()
  }

  @HostListener('wheel', ['$event'])
  mousewheel(event: WheelEvent) {
    if (event.ctrlKey) {
      // this.scaleCanvasVertically(event)
    } else {
      this.scaleCanvas(event)
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
    this.handleMouseMove(event)
  }

  private draw() {

    console.log("ScrollX: " + this.scrollX, "ScaleX: "+this.scale.x, "OffsetX: "+this.cameraOffset.x)

    let x = 0 - this.cameraOffset.x / this.scale.x
    let y = 0 - this.cameraOffset.y / this.scale.y
    let w = this.context.canvas.width / this.scale.x
    let h = this.context.canvas.height / this.scale.y

    this.context.clearRect(x,y,w,h)

    this.context.fillStyle = "rgba(18,150,203,0.52)"
    this.context.fillRect(x,y,w,h)

    this.context.fillStyle = "rgba(20,29,33,0.52)"
    this.context.fillRect(200-this.scrollX,200-this.scrollY,200,200)

    // this.context.beginPath()
    // this.context.lineWidth = 1
    // this.context.strokeStyle = '#FFFFFF'
    // this.context.moveTo(0-this.scrollX, 500-this.scrollY)
    // this.context.lineTo(500-this.scrollX,500-this.scrollY)
    // this.context.stroke()
    // console.log(this.scrollX)

    // 1. F5
    // 2. scale
    // 3. scaleVertically
    // --> bug

    requestAnimationFrame(this.draw.bind(this))

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
  }

  private scaleCanvas(event: WheelEvent) {
    event.preventDefault()
    event.stopPropagation()
    let previousScale = {x: this.scale.x, y: this.scale.y}
    let direction = event.deltaY > 0 ? -1 : 1

    if (direction > 0) {
      this.scale.x = this.scale.x + this.scaleFactor * this.scale.x * direction
      this.scale.y = this.scale.y + this.scaleFactor * this.scale.y * direction
    } else {
      this.scale.x = this.scale.x + this.scaleFactor * this.scale.x * direction
      this.scale.y = this.scale.y + this.scaleFactor * this.scale.y * direction
    }

    this.label_scale = this.scale.y.toFixed(1)

    this.scrollX += ((event.offsetX - this.cameraOffset.x) / previousScale.x) - ((event.offsetX - this.cameraOffset.x) / this.scale.x);
    this.scrollY += ((event.offsetY - this.cameraOffset.y) / previousScale.y) - ((event.offsetY - this.cameraOffset.y) / this.scale.y);

    this.applyScale()
  }

  private scaleCanvasVertically(event: WheelEvent) {
    this.scaledVertically = true
    event.preventDefault()
    event.stopPropagation()
    let previousScale = {x: this.scale.x, y: this.scale.y}
    let direction = event.deltaY > 0 ? -1 : 1

    // this.scale.x = this.scale.x + this.scaleFactor * direction
    this.scale.y = this.scale.y + this.scaleFactor * direction

    //this.scrollX += ((event.offsetX - this.cameraOffset.x) / previousScale.x) - ((event.offsetX - this.cameraOffset.x) / this.scale.x);
    this.scrollY += ((event.offsetY - this.cameraOffset.y) / previousScale.y) - ((event.offsetY - this.cameraOffset.y) / this.scale.y);

    this.scale.x = 1

    this.applyScale();
  }

  private applyScale() {
    this.canvas.nativeElement.width = this.appWidth
    this.canvas.nativeElement.height = this.appHeight

    this.context.setTransform(1, 0, 0, 1, this.cameraOffset.x, this.cameraOffset.y)
    this.context.scale(this.scale.x, this.scale.y)
  }
}
