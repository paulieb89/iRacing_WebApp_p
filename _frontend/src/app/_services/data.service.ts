import {Injectable} from '@angular/core';
import {Driver, Event, EventData} from "./api.service";
import {BehaviorSubject} from "rxjs";
import {BoxplotProperties} from "../analytics/diagram/boxplot/boxplot.component";
import {Mode, ModeType} from "../analytics/sidebar/sidebar.component";
import {LocalstorageService} from "./localstorage.service";

@Injectable({
  providedIn: 'root'
})

export class DataService {

  subsessionInfo: Event
  private analyticsData_sre = new BehaviorSubject<EventData>(this.init_analyticsData())
  analyticsData = this.analyticsData_sre.asObservable()
  private boxplotProperties_src = new BehaviorSubject<BoxplotProperties>(this.init_bpprop())
  boxplotProperties = this.boxplotProperties_src.asObservable()
  private mode_src = new BehaviorSubject<Mode>(new Mode(ModeType.Boxplot))
  mode = this.mode_src.asObservable()

  constructor(private localStorage: LocalstorageService) {
    try {
      this.subsessionInfo = this.localStorage.load("subsessionInfo")
    } catch (e) {
      this.subsessionInfo = new Event()
    }
  }

  changeMode(mode: Mode) {
    this.mode_src.next(mode)
  }

  changeSubsession(subsession: EventData) {
    this.analyticsData_sre.next(subsession)
  }

  changeBpprop(bprop: BoxplotProperties) {
    this.boxplotProperties_src.next(bprop)
  }

  private init_bpprop() {
    try {
      return this.localStorage.load<any>("bpprop")
    } catch (e) {
      return this.loadDefaultBpprop()
    }
  }

  private loadDefaultBpprop() {
    let bpprop = BoxplotProperties.getInstance()
    bpprop.userDriver = new Driver()
    bpprop.userDriver.name = "Florian Niedermeier2"
    return bpprop
  }

  private init_analyticsData() {
    try {
      return this.localStorage.load<any>("analyticsData")
    } catch (e) {
      return this.createEmptyAnalyticsData()
    }
  }

  createEmptyAnalyticsData() {

    let driver = new Driver();

    let analyticsData = new EventData()

    for (let i = 0; i < analyticsData.drivers.length; i++) {
      analyticsData.drivers[i] = {...driver, finish_position: i+1, finish_position_in_class: i+1
      }
    }

    return analyticsData
  }
}
